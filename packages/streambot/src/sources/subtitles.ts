import path from "node:path";
import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SubtitlePref } from "@shepherdjerred/streambot/sources/source.ts";
import { parseJson } from "@shepherdjerred/streambot/util/errors.ts";

/**
 * Pure subtitle helpers: name parsing, cross-source ranking, codec classification, and yt-dlp arg
 * building — deterministic and unit-testable with zero I/O. The ffprobe/ffmpeg/yt-dlp glue that stages
 * a chosen track to a temp file lives in {@link file://./subtitle-io.ts}; the ffmpeg filter graph that
 * burns the staged file (incl. path escaping) is owned by the discord-video-stream fork.
 *
 * Discord Go-Live carries a single video track, so subtitles are **burned in** via ffmpeg's
 * `subtitles=` (libass) filter — text only (SRT/ASS/SSA/VTT/mov_text); image subs (PGS/VobSub/DVB) are
 * skipped. Sidecar and embedded text tracks compete in ONE ranking (language → full/SDH/forced quality
 * → source), so a forced-only sidecar no longer shadows a full embedded track.
 */

/** Text-subtitle sidecar extensions we can burn with libass (image formats like VobSub are excluded). */
const SIDECAR_EXTENSION_SET = new Set(["srt", "ass", "ssa", "vtt"]);

/** Subtitle "modifier" suffixes seen in Plex/Bazarr sidecar names (e.g. `Movie.en.forced.srt`). */
export const SubtitleModifierSchema = z.enum(["forced", "hi", "sdh", "cc"]);
export type SubtitleModifier = z.infer<typeof SubtitleModifierSchema>;

/** ffmpeg subtitle codecs libass can render (burnable). */
const TEXT_SUBTITLE_CODECS = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "mov_text",
  "webvtt",
  "vtt",
  "text",
]);
/** Image/bitmap subtitle codecs that the `subtitles` filter cannot burn (need `overlay`). */
const IMAGE_SUBTITLE_CODECS = new Set([
  "hdmv_pgs_subtitle",
  "pgssub",
  "dvd_subtitle",
  "dvdsub",
  "dvb_subtitle",
  "dvbsub",
  "xsub",
]);

export type SubtitleClass = "text" | "image" | "other";

/** Classify a subtitle codec as burnable text, un-burnable image, or unknown. */
export function classifySubtitleCodec(codec: string): SubtitleClass {
  const c = codec.toLowerCase();
  if (TEXT_SUBTITLE_CODECS.has(c)) return "text";
  if (IMAGE_SUBTITLE_CODECS.has(c)) return "image";
  return "other";
}

export type SidecarInfo = {
  readonly lang: string | null;
  readonly modifier: SubtitleModifier | null;
};

/**
 * Parse a sidecar filename relative to its video's base name (no extension). Returns the language and
 * modifier, or null if `filename` isn't a subtitle sidecar for that video. Handles the real Plex/Bazarr
 * convention `<videoBase>.<lang>[.<modifier>].<ext>` (e.g. `… Proper.en.forced.srt`, `… 1080p.en.srt`,
 * `… .zh-TW.srt`, `… .en.hi.srt`).
 *
 * Position matters: the FIRST token after the base is always the language — even when it's a code like
 * `hi` (Hindi) that also names a modifier (hearing-impaired). Only the tokens AFTER the language are
 * treated as modifiers, so `Movie.hi.srt` is Hindi while `Movie.en.hi.srt` is English + HI.
 */
export function parseSidecarName(
  filename: string,
  videoBase: string,
): SidecarInfo | null {
  if (!filename.startsWith(videoBase)) return null;
  const rest = filename.slice(videoBase.length);
  if (!rest.startsWith(".")) return null;

  const ext = path.extname(rest).slice(1).toLowerCase();
  if (!SIDECAR_EXTENSION_SET.has(ext)) return null;

  // Strip the leading "." and the ".<ext>" → "en.forced" | "en" | "" | "hi".
  const middle = rest.slice(1, rest.length - (ext.length + 1));
  const tokens = middle.length > 0 ? middle.split(".") : [];

  const [langToken, ...modifierTokens] = tokens;
  let modifier: SubtitleModifier | null = null;
  for (const raw of modifierTokens) {
    const parsed = SubtitleModifierSchema.safeParse(raw.toLowerCase());
    if (parsed.success) {
      modifier = parsed.data;
      break;
    }
  }
  return { lang: langToken ?? null, modifier };
}

export type SidecarCandidate = SidecarInfo & { readonly file: string };

/** ISO 639-2 (and legacy bibliographic) codes → ISO 639-1, for the languages that show up in real
 * media tags. Sidecars are usually tagged `en` while embedded streams are usually `eng`; without
 * canonicalization those would rank as DIFFERENT languages and the preference list
 * `["en", "eng", "en-US"]` would order them by list position — making a forced `en` sidecar beat
 * a full `eng` embedded track on "language" (the Endgame bug). */
const ISO639_2_TO_1: Record<string, string> = {
  eng: "en",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  spa: "es",
  ita: "it",
  jpn: "ja",
  chi: "zh",
  zho: "zh",
  kor: "ko",
  rus: "ru",
  por: "pt",
  dut: "nl",
  nld: "nl",
  ara: "ar",
  hin: "hi",
  pol: "pl",
  tur: "tr",
  swe: "sv",
  nor: "no",
  dan: "da",
  fin: "fi",
  cze: "cs",
  ces: "cs",
  gre: "el",
  ell: "el",
  heb: "he",
  hun: "hu",
  tha: "th",
  vie: "vi",
  ukr: "uk",
  ron: "ro",
  rum: "ro",
};

/** Canonicalize a language tag for comparison: lowercase, strip the region (`en-US` → `en`), and
 * map ISO 639-2 to 639-1 (`eng` → `en`). Unknown codes pass through lowercased. */
export function canonicalizeLangTag(tag: string): string {
  const base = tag.toLowerCase().split(/[-_]/u)[0] ?? tag.toLowerCase();
  return ISO639_2_TO_1[base] ?? base;
}

function languageScore(
  lang: string | null,
  langPrefs: readonly string[],
): number {
  if (lang === null) return langPrefs.length + 1;
  const canonical = canonicalizeLangTag(lang);
  // Index of the FIRST pref whose canonical form matches — so alias lists like
  // ["en", "eng", "en-US"] collapse to one English rank and modifier quality can decide.
  const idx = langPrefs.findIndex((p) => canonicalizeLangTag(p) === canonical);
  return idx === -1 ? langPrefs.length : idx;
}

/** Modifier preference: full subs (none) > hearing-impaired/SDH/CC > forced (partial). Lower is better. */
function modifierScore(modifier: SubtitleModifier | null): number {
  if (modifier === null) return 0;
  if (modifier === "forced") return 2;
  return 1;
}

/**
 * A burnable subtitle candidate from any source, ranked uniformly by
 * {@link rankSubtitleCandidates}. Sidecars carry their filename (relative to the video's
 * directory); embedded tracks their subtitle-relative stream index (for `-map 0:s:<i>`).
 */
export type SubtitleCandidate =
  | {
      readonly kind: "sidecar";
      readonly file: string;
      readonly lang: string | null;
      readonly modifier: SubtitleModifier | null;
    }
  | {
      readonly kind: "embedded";
      readonly subtitleIndex: number;
      readonly codec: string;
      readonly lang: string | null;
      readonly modifier: SubtitleModifier | null;
    };

/** Sidecars beat embedded tracks ONLY at equal language + modifier quality (extraction-free). */
function sourceScore(candidate: SubtitleCandidate): number {
  return candidate.kind === "sidecar" ? 0 : 1;
}

/** Deterministic intra-source tie-break: filename for sidecars, stream order for embedded. */
function candidateTieBreak(a: SubtitleCandidate, b: SubtitleCandidate): number {
  if (a.kind === "sidecar" && b.kind === "sidecar") {
    return a.file.localeCompare(b.file);
  }
  if (a.kind === "embedded" && b.kind === "embedded") {
    return a.subtitleIndex - b.subtitleIndex;
  }
  return 0; // different kinds were already ordered by sourceScore
}

/**
 * Rank subtitle candidates best-first ACROSS sources: language preference, then modifier quality
 * (full > HI/SDH/CC > forced), then source (sidecar over embedded as a tie-break only), then a
 * deterministic intra-source order. Ranking quality before source is the point: a forced-only
 * sidecar must not beat a full embedded text track (a 4K remux with `<base>.en.forced.srt` next
 * to it is the canonical case — the forced sidecar is nearly empty). When `pinnedModifier` is set
 * (e.g. `sublang:en.forced`) candidates with that modifier are preferred, falling back to the
 * rest if none match.
 */
export function rankSubtitleCandidates(
  candidates: readonly SubtitleCandidate[],
  langPrefs: readonly string[],
  pinnedModifier: SubtitleModifier | null = null,
): SubtitleCandidate[] {
  const pinned =
    pinnedModifier === null
      ? []
      : candidates.filter((c) => c.modifier === pinnedModifier);
  const pool = pinned.length > 0 ? pinned : candidates;
  return pool.toSorted(
    (a, b) =>
      languageScore(a.lang, langPrefs) - languageScore(b.lang, langPrefs) ||
      modifierScore(a.modifier) - modifierScore(b.modifier) ||
      sourceScore(a) - sourceScore(b) ||
      candidateTieBreak(a, b),
  );
}

/**
 * Pick the best sidecar among sidecars only. Thin wrapper over
 * {@link rankSubtitleCandidates} so sidecar-only and cross-source ranking can never diverge.
 */
export function rankSidecars(
  candidates: readonly SidecarCandidate[],
  langPrefs: readonly string[],
  pinnedModifier: SubtitleModifier | null = null,
): SidecarCandidate | null {
  const ranked = rankSubtitleCandidates(
    candidates.map((c) => ({ kind: "sidecar" as const, ...c })),
    langPrefs,
    pinnedModifier,
  );
  const best = ranked[0];
  return best?.kind === "sidecar"
    ? { file: best.file, lang: best.lang, modifier: best.modifier }
    : null;
}

export type EffectiveSubtitleConfig = {
  readonly enabled: boolean;
  readonly languages: string[];
  readonly pinnedModifier: SubtitleModifier | null;
};

/** Split a `sublang` request into a language and an optional trailing modifier (`en.forced` → both). */
export function parseLangPref(sublang: string): {
  language: string;
  modifier: SubtitleModifier | null;
} {
  const parts = sublang.split(".");
  if (parts.length > 1) {
    const parsed = SubtitleModifierSchema.safeParse(
      parts.at(-1)?.toLowerCase() ?? "",
    );
    if (parsed.success) {
      return { language: parts.slice(0, -1).join("."), modifier: parsed.data };
    }
  }
  return { language: sublang, modifier: null };
}

/** Resolve the effective subtitle settings for a request: per-request pref overrides global config. */
export function effectiveSubtitleConfig(
  pref: SubtitlePref | undefined,
  config: Config,
): EffectiveSubtitleConfig {
  const enabled = pref?.enabled ?? config.subtitles.enabled;
  if (pref?.language !== undefined && pref.language.length > 0) {
    const { language, modifier } = parseLangPref(pref.language);
    return { enabled, languages: [language], pinnedModifier: modifier };
  }
  return {
    enabled,
    languages: [...config.subtitles.languages],
    pinnedModifier: null,
  };
}

/** Build the yt-dlp args that write (and convert to SRT) the preferred subtitle track(s) for a target. */
export function ytdlpSubtitleArgs(
  target: string,
  langPrefs: readonly string[],
  includeAuto: boolean,
  outputTemplate: string,
): string[] {
  const langs = langPrefs.length > 0 ? langPrefs.join(",") : "en";
  return [
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--write-subs",
    ...(includeAuto ? ["--write-auto-subs"] : []),
    "--sub-langs",
    langs,
    "--sub-format",
    "srt/vtt/best",
    "--convert-subs",
    "srt",
    "-o",
    outputTemplate,
    target,
  ];
}

/** SRT preferred (already our convert target), then ASS/SSA, then everything else (e.g. VTT). */
function subtitleExtRank(f: string): number {
  const e = path.extname(f).slice(1).toLowerCase();
  if (e === "srt") return 0;
  if (e === "ass" || e === "ssa") return 1;
  return 2;
}

/** Pick the best subtitle file yt-dlp wrote: preferred language first, then SRT over other formats. */
export function pickWrittenSubtitleFile(
  files: readonly string[],
  langPrefs: readonly string[],
): string | null {
  const subs = files.filter((f) => /\.(?:srt|ass|ssa|vtt)$/iu.test(f));
  if (subs.length === 0) return null;
  const langRank = (f: string): number => {
    const lower = f.toLowerCase();
    const idx = langPrefs.findIndex((p) =>
      lower.includes(`.${p.toLowerCase()}.`),
    );
    return idx === -1 ? langPrefs.length : idx;
  };
  const sorted = subs.toSorted(
    (a, b) =>
      langRank(a) - langRank(b) ||
      subtitleExtRank(a) - subtitleExtRank(b) ||
      a.localeCompare(b),
  );
  return sorted[0] ?? null;
}

const FfprobeStreamSchema = z.object({
  codec_name: z.string().optional(),
  tags: z
    .object({ language: z.string().optional(), title: z.string().optional() })
    .optional(),
  disposition: z
    .object({
      forced: z.number().optional(),
      hearing_impaired: z.number().optional(),
    })
    .optional(),
});
const FfprobeOutputSchema = z.object({
  streams: z.array(FfprobeStreamSchema).default([]),
});
export type FfprobeSubtitleStream = z.infer<typeof FfprobeStreamSchema>;

/** Parse `ffprobe -select_streams s -show_streams -of json` output into its subtitle streams. */
export function parseFfprobeSubtitles(stdout: string): FfprobeSubtitleStream[] {
  return FfprobeOutputSchema.parse(parseJson(stdout)).streams;
}

export type EmbeddedPick = {
  /** Subtitle-relative index for `-map 0:s:<i>` (position among subtitle streams). */
  readonly subtitleIndex: number;
  readonly codec: string;
};

/**
 * Derive a {@link SubtitleModifier} for an embedded track from its disposition flags and title
 * tag. Dispositions are authoritative; title matching is a conservative fallback for remuxes that
 * tag `"SDH"`/`"FORCED"` in the title without setting the flag. Bare `"CC"` titles are deliberately
 * not matched (too false-positive-prone); unknown → null (treated as a full track).
 */
export function embeddedSubtitleModifier(
  stream: FfprobeSubtitleStream,
): SubtitleModifier | null {
  if ((stream.disposition?.forced ?? 0) === 1) return "forced";
  if ((stream.disposition?.hearing_impaired ?? 0) === 1) return "sdh";
  const title = stream.tags?.title ?? "";
  if (/\bforced\b/iu.test(title)) return "forced";
  if (/\bsdh\b/iu.test(title) || /hearing.?impaired/iu.test(title)) {
    return "sdh";
  }
  return null;
}

/**
 * Map ffprobe subtitle streams to burnable embedded candidates: text codecs only (PGS/VobSub
 * image subs are skipped — libass can't render them), preserving each stream's subtitle-relative
 * index for `-map 0:s:<i>`.
 */
export function toEmbeddedCandidates(
  streams: readonly FfprobeSubtitleStream[],
): SubtitleCandidate[] {
  return streams
    .map((s, subtitleIndex) => ({ s, subtitleIndex }))
    .filter(
      ({ s }) =>
        s.codec_name !== undefined &&
        classifySubtitleCodec(s.codec_name) === "text",
    )
    .map(({ s, subtitleIndex }) => ({
      kind: "embedded" as const,
      subtitleIndex,
      codec: s.codec_name ?? "",
      lang: s.tags?.language ?? null,
      modifier: embeddedSubtitleModifier(s),
    }));
}

/**
 * Choose a burnable embedded subtitle stream among embedded tracks only. Thin wrapper over
 * {@link rankSubtitleCandidates}, so full > SDH > forced ordering applies to embedded tracks the
 * same way it does to sidecars. Returns the subtitle-relative index, not the absolute index.
 */
export function pickEmbeddedSubtitle(
  streams: readonly FfprobeSubtitleStream[],
  langPrefs: readonly string[],
  pinnedModifier: SubtitleModifier | null = null,
): EmbeddedPick | null {
  const ranked = rankSubtitleCandidates(
    toEmbeddedCandidates(streams),
    langPrefs,
    pinnedModifier,
  );
  const best = ranked[0];
  return best?.kind === "embedded"
    ? { subtitleIndex: best.subtitleIndex, codec: best.codec }
    : null;
}
