import path from "node:path";
import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SubtitlePref } from "@shepherdjerred/streambot/sources/source.ts";
import { parseJson } from "@shepherdjerred/streambot/util/errors.ts";

/**
 * Pure subtitle helpers: name parsing, ranking, codec classification, escaping, and ffmpeg/yt-dlp arg
 * building — deterministic and unit-testable with zero I/O. The ffprobe/ffmpeg/yt-dlp glue that stages
 * a chosen track to a temp file lives in {@link file://./subtitle-io.ts}.
 *
 * Discord Go-Live carries a single video track, so subtitles are **burned in** via ffmpeg's
 * `subtitles=` (libass) filter — text only (SRT/ASS/SSA/VTT/mov_text); image subs (PGS/VobSub/DVB) are
 * skipped (covered by a sibling sidecar on real Remux libraries).
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

  // Strip the leading "." and the ".<ext>" → "en.forced" | "en" | "" | "forced".
  const middle = rest.slice(1, rest.length - (ext.length + 1));
  const tokens = middle.length > 0 ? middle.split(".") : [];

  let modifier: SubtitleModifier | null = null;
  const langTokens: string[] = [];
  for (const raw of tokens) {
    const parsed = SubtitleModifierSchema.safeParse(raw.toLowerCase());
    if (modifier === null && parsed.success) {
      modifier = parsed.data;
    } else {
      langTokens.push(raw);
    }
  }
  return { lang: langTokens[0] ?? null, modifier };
}

export type SidecarCandidate = SidecarInfo & { readonly file: string };

function languageScore(
  lang: string | null,
  langPrefs: readonly string[],
): number {
  if (lang === null) return langPrefs.length + 1;
  const idx = langPrefs.findIndex(
    (p) => p.toLowerCase() === lang.toLowerCase(),
  );
  return idx === -1 ? langPrefs.length : idx;
}

/** Modifier preference: full subs (none) > hearing-impaired/SDH/CC > forced (partial). Lower is better. */
function modifierScore(modifier: SubtitleModifier | null): number {
  if (modifier === null) return 0;
  if (modifier === "forced") return 2;
  return 1;
}

/**
 * Pick the best sidecar: by language preference, then modifier preference, then filename (deterministic
 * tie-break). When `pinnedModifier` is set (e.g. user asked `sublang:en.forced`), candidates with that
 * modifier are preferred but the call still falls back to the rest if none match.
 */
export function rankSidecars(
  candidates: readonly SidecarCandidate[],
  langPrefs: readonly string[],
  pinnedModifier: SubtitleModifier | null = null,
): SidecarCandidate | null {
  if (candidates.length === 0) return null;
  const pinned =
    pinnedModifier === null
      ? []
      : candidates.filter((c) => c.modifier === pinnedModifier);
  const pool = pinned.length > 0 ? pinned : candidates;
  const sorted = pool.toSorted(
    (a, b) =>
      languageScore(a.lang, langPrefs) - languageScore(b.lang, langPrefs) ||
      modifierScore(a.modifier) - modifierScore(b.modifier) ||
      a.file.localeCompare(b.file),
  );
  return sorted[0] ?? null;
}

/** Escape a path for use inside an ffmpeg `subtitles=` filter argument. */
export function escapeSubtitlePath(p: string): string {
  return p
    .replaceAll("\\", "\\\\")
    .replaceAll(":", String.raw`\:`)
    .replaceAll("'", String.raw`\'`);
}

/** Build the `subtitles=<path>` video filter that burns a subtitle file into the frame. */
export function buildSubtitleFilter(subtitlePath: string): string {
  return `subtitles=${escapeSubtitlePath(subtitlePath)}`;
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
  tags: z.object({ language: z.string().optional() }).optional(),
  disposition: z.object({ forced: z.number().optional() }).optional(),
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
 * Choose a burnable embedded subtitle stream: text codecs only (PGS/VobSub image subs are skipped),
 * ranked by language preference then forced-disposition (full preferred unless `forced` is pinned).
 * Returns the subtitle-relative index (its position among subtitle streams), not the absolute index.
 */
export function pickEmbeddedSubtitle(
  streams: readonly FfprobeSubtitleStream[],
  langPrefs: readonly string[],
  pinnedModifier: SubtitleModifier | null = null,
): EmbeddedPick | null {
  const candidates = streams
    .map((s, subtitleIndex) => ({ s, subtitleIndex }))
    .filter(
      ({ s }) =>
        s.codec_name !== undefined &&
        classifySubtitleCodec(s.codec_name) === "text",
    );
  if (candidates.length === 0) return null;

  const wantForced = pinnedModifier === "forced";
  const langRank = (s: FfprobeSubtitleStream): number =>
    languageScore(s.tags?.language ?? null, langPrefs);
  const forcedRank = (s: FfprobeSubtitleStream): number => {
    const isForced = (s.disposition?.forced ?? 0) === 1;
    if (wantForced) return isForced ? 0 : 1;
    return isForced ? 1 : 0;
  };
  const sorted = candidates.toSorted(
    (a, b) =>
      langRank(a.s) - langRank(b.s) ||
      forcedRank(a.s) - forcedRank(b.s) ||
      a.subtitleIndex - b.subtitleIndex,
  );
  const best = sorted[0];
  return best === undefined
    ? null
    : { subtitleIndex: best.subtitleIndex, codec: best.s.codec_name ?? "" };
}
