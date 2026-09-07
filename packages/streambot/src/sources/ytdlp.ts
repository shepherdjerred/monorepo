import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type {
  MediaKind,
  MediaKindPass,
} from "@shepherdjerred/streambot/sources/media-kind.ts";
import {
  buildFormatSelector,
  NoUsableFormatError,
} from "@shepherdjerred/streambot/sources/format-select.ts";
import {
  classifyYtdlpInfo,
  isNoPlayableFormatIssue,
  parseYtdlpInfo,
  toResolvedSource,
  type YtdlpInfo,
} from "@shepherdjerred/streambot/sources/ytdlp-info.ts";
import {
  getErrorMessage,
  parseJson,
} from "@shepherdjerred/streambot/util/errors.ts";
import {
  BlockedSourceError,
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { resolveSubtitleForYtdlp } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import { listYtdlpSubtitleCandidates } from "@shepherdjerred/streambot/sources/subtitles.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";
import { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("ytdlp");

/** The yt-dlp target string for a source: a URL/file passthrough or a `ytsearch1:` query. */
export function ytdlpTarget(source: Source): string {
  switch (source.kind) {
    case "url": {
      return source.url;
    }
    case "search": {
      return `ytsearch1:${source.query}`;
    }
    case "file": {
      return source.path;
    }
  }
}

/**
 * Ignore any `yt-dlp.conf` on the host. Every invocation below passes this, and it is not
 * defensive tidiness: a user config that sets `-o "%(title)s [%(id)s].%(ext)s"` makes yt-dlp read
 * the template fragment as a second URL and the resolve dies with
 * `ERROR: [generic] '[%(id)s].%(ext)s' is not a valid URL`. Two people hit exactly that on this
 * repo while trying to reproduce a resolve locally.
 *
 * Production is unaffected either way — the container has no user config — so this changes nothing
 * that runs today. What it buys is that a local reproduction behaves like production instead of
 * like whoever's dotfiles are on the machine, which is precisely when someone is reaching for it.
 */
const IGNORE_HOST_CONFIG = "--ignore-config";

/**
 * Build the argument list for a metadata probe (no download), asking for one specific format
 * selection.
 *
 * The selector is a PARAMETER rather than a constant because resolution runs the same probe twice
 * with different selectors — see {@link resolveWithYtdlp}. It replaces a hardcoded `-f best`, which
 * most of YouTube can no longer satisfy at all; `format-select.ts` carries the measurements.
 */
export function buildInfoArgs(
  source: Source,
  formatSelector: string,
): string[] {
  return [
    IGNORE_HOST_CONFIG,
    // `--dump-single-json ytsearch1:query` returns a playlist wrapper whose direct media URL is
    // nested under `entries[0]`. `--dump-json` emits the selected video as one top-level JSON line,
    // which is the stable shape validated by YtdlpInfoSchema for URLs and searches alike.
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--skip-download",
    "-f",
    formatSelector,
    ytdlpTarget(source),
  ];
}

/**
 * Build the argument list for a subtitle-enumeration-only probe: same shape as
 * {@link buildInfoArgs}, but `--dump-single-json` and no `-f` — this call only reads the subtitle
 * dicts, which a playlist wrapper carries just as well and which no format selection affects.
 */
export function buildSubtitleEnumerationArgs(source: Source): string[] {
  return [
    IGNORE_HOST_CONFIG,
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--skip-download",
    ytdlpTarget(source),
  ];
}

const YtdlpSearchResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  webpage_url: z.string().optional(),
  url: z.string().optional(),
  channel: z.string().optional(),
  uploader: z.string().optional(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
});

export type YtdlpSearchResult = {
  readonly title: string;
  readonly url: string;
  readonly channel?: string;
  readonly thumbnailUrl?: string;
  readonly durationSeconds?: number;
};

/**
 * Argument list for a flat YouTube search. Extracted from {@link searchYoutube} for the same reason
 * the two probe builders exist: an argument array assembled inline inside an async function that
 * spawns a subprocess cannot be asserted on by any unit test, so `--ignore-config` could be dropped
 * from it and nothing would fail. Coverage that cannot fail is not coverage.
 */
export function buildSearchArgs(query: string, limit: number): string[] {
  return [
    IGNORE_HOST_CONFIG,
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--no-progress",
    "--playlist-end",
    String(limit),
    `ytsearch${String(limit)}:${query}`,
  ];
}

/** Search YouTube without resolving or persisting signed media URLs. */
export async function searchYoutube(
  config: Pick<Config, "ytDlpPath">,
  query: string,
  signal: AbortSignal,
  limit = 5,
): Promise<YtdlpSearchResult[]> {
  const { stdout, stderr, exitCode } = await runSubprocess(
    [config.ytDlpPath, ...buildSearchArgs(query, limit)],
    signal,
  );
  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp search failed (code ${String(exitCode)}): ${stderr.trim()}`,
    );
  }
  const results: YtdlpSearchResult[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = YtdlpSearchResultSchema.parse(parseJson(line));
    const candidateUrl = parsed.webpage_url ?? parsed.url;
    const url =
      candidateUrl?.startsWith("http") === true
        ? candidateUrl
        : `https://www.youtube.com/watch?v=${parsed.id}`;
    if (isBlockedText(parsed.title) || isBlockedUrl(url)) continue;
    const channel = parsed.channel ?? parsed.uploader;
    results.push({
      title: parsed.title,
      url,
      ...(channel === undefined ? {} : { channel }),
      ...(parsed.thumbnail === undefined
        ? {}
        : { thumbnailUrl: parsed.thumbnail }),
      ...(parsed.duration === undefined
        ? {}
        : { durationSeconds: parsed.duration }),
    });
  }
  return results.slice(0, limit);
}

/** True if a URL looks like a playlist that should be expanded into individual items. */
export function isLikelyPlaylist(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.searchParams.has("list") || /\/playlist(?:\/|$)/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const PlaylistLineSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
});
export type PlaylistItem = z.infer<typeof PlaylistLineSchema>;

/**
 * Argument list for flat playlist expansion. `--print` renders one `url\ttitle` row per entry, which
 * is cheaper than `--dump-json` for a listing that only needs those two fields.
 */
export function buildPlaylistArgs(url: string): string[] {
  return [
    IGNORE_HOST_CONFIG,
    "--flat-playlist",
    "--no-warnings",
    "--print",
    "%(url)s\t%(title)s",
    url,
  ];
}

/**
 * Expand a playlist URL into individual `{ url, title }` items via `yt-dlp --flat-playlist`, capped
 * at `config.playlistLimit`. Adult items are dropped here too (defense before they reach the queue).
 */
export async function expandPlaylist(
  config: Config,
  url: string,
  signal: AbortSignal,
): Promise<PlaylistItem[]> {
  const { stdout, stderr, exitCode } = await runSubprocess(
    [config.ytDlpPath, ...buildPlaylistArgs(url)],
    signal,
  );
  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp playlist expansion failed (code ${String(exitCode)}): ${stderr.trim()}`,
    );
  }

  const items: PlaylistItem[] = [];
  for (const line of stdout.split("\n")) {
    const [itemUrl, title] = line.split("\t");
    const parsed = PlaylistLineSchema.safeParse({ url: itemUrl, title });
    if (!parsed.success) {
      continue;
    }
    if (isBlockedUrl(parsed.data.url) || isBlockedText(parsed.data.title)) {
      continue;
    }
    items.push(parsed.data);
    if (items.length >= config.playlistLimit) {
      log.warn("playlist truncated", { limit: config.playlistLimit });
      break;
    }
  }
  return items;
}

/**
 * Run one `--dump-json` metadata pass with a given `-f` selector and validate the result. Every
 * failure mode is fatal: a non-zero exit carries yt-dlp's own message (which `classifyPlayError`
 * buckets), and an unparseable payload — including one with no playable format, which the schema's
 * refinement rejects — is a broken contract, not something to paper over.
 */
async function runInfoPass(
  config: Config,
  source: Source,
  selection: { readonly kind: MediaKind; readonly formatSelector: string },
  signal: AbortSignal,
): Promise<YtdlpInfo> {
  const { stdout, stderr, exitCode } = await runSubprocess(
    [config.ytDlpPath, ...buildInfoArgs(source, selection.formatSelector)],
    signal,
  );
  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp exited with code ${String(exitCode)}: ${stderr.trim()}`,
    );
  }
  try {
    return parseYtdlpInfo(stdout);
  } catch (error) {
    // "yt-dlp selected nothing playable" is a normal outcome of a selector that missed on every
    // branch, and it deserves a reply the user can act on. Everything else really is a shape
    // mismatch — a broken contract — and keeps the generic parse-failure message.
    if (isNoPlayableFormatIssue(error)) {
      throw new NoUsableFormatError(
        selection.kind,
        `selector: ${selection.formatSelector}`,
      );
    }
    throw new Error(
      `could not parse yt-dlp output: ${getErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Resolve a URL/search source to a streamable {@link ResolvedSource} by shelling out to the system
 * `yt-dlp`.
 *
 * Chicken-and-egg: the `-f` selector depends on whether the item is music, and the metadata that
 * decides that comes back from the very call the selector is for. Resolved by asking for **audio
 * first** and paying for a second call only when the answer turns out to be video:
 *
 * | `mode`    | calls | why                                                                  |
 * |-----------|-------|----------------------------------------------------------------------|
 * | `music`   | 1     | the kind is already known; ask for audio                              |
 * | `video`   | 1     | the kind is already known; ask for video                              |
 * | `auto`    | 1-2   | audio first — a song, the common case, stops here                     |
 *
 * The audio-first pass is classified with `pass: "audio-first"`, which blinds the classifier to
 * "the selected stream has no picture" — trivially true of an audio selection, and left in it would
 * make every item music. The second pass re-classifies with the real answer, which is also what
 * catches an explicit `mode: "video"` on a source that has no video at all (the selector's `/best`
 * tail lands on an audio format, rule 1 downgrades to music) instead of crashing the fork.
 *
 * Both passes share the caller's {@link AbortSignal}, so the machine's resolve wedge guard and
 * `/stream play`'s pre-ack timeout bound the pair, not each half. That is affordable here because
 * `play-command.ts` defers the interaction before calling this.
 */
export async function resolveWithYtdlp(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  const maxHeight = config.stream.height;
  const firstKind: MediaKind = source.mode === "video" ? "video" : "music";
  const firstPass: MediaKindPass =
    source.mode === "video" ? "video" : "audio-first";
  log.debug("probing source", {
    target: ytdlpTarget(source),
    pass: firstPass,
  });

  let info = await runInfoPass(
    config,
    source,
    {
      kind: firstKind,
      formatSelector: buildFormatSelector({ kind: firstKind, maxHeight }),
    },
    signal,
  );

  // Defense in depth: a search/redirect can land on an adult site the request text didn't reveal.
  if (isBlockedUrl(info.webpage_url ?? "") || isBlockedText(info.title)) {
    throw new BlockedSourceError(info.webpage_url ?? info.title);
  }

  let decision = classifyYtdlpInfo(info, source.mode, firstPass);
  let passes = 1;
  if (firstKind === "music" && decision.kind === "video") {
    info = await runInfoPass(
      config,
      source,
      {
        kind: "video",
        formatSelector: buildFormatSelector({ kind: "video", maxHeight }),
      },
      signal,
    );
    decision = classifyYtdlpInfo(info, source.mode, "video");
    passes = 2;
  }

  const base = toResolvedSource(info, { mediaKind: decision.kind });
  // The only durable record of a classification. `decidedBy` explains a music/video call a user
  // disputes, and the split-input flag explains a silent or picture-less play — both long after the
  // signed URLs in this response have expired and the resolve can no longer be reproduced.
  log.info("source classified", {
    title: info.title,
    mediaKind: decision.kind,
    decidedBy: decision.decidedBy,
    mode: source.mode,
    passes,
    splitAudioInput: base.audioInput !== undefined,
  });
  // Live streams have no fetchable subtitle file; skip subtitle resolution for them.
  if (info.is_live === true) {
    return base;
  }
  const subtitle = await resolveSubtitleForYtdlp(
    config,
    info.webpage_url ?? ytdlpTarget(source),
    source.subtitles,
    signal,
  );
  return { ...base, ...(subtitle === undefined ? {} : { subtitle }) };
}

/**
 * Enumerate the subtitle/caption tracks yt-dlp reports for a url/search source, for `/stream
 * subtitles`'s track picker. A FRESH `--dump-single-json` call (separate from the one
 * {@link resolveWithYtdlp} already made at play time) — deliberate: the enumeration's `url` fields
 * are signed/time-limited, so nothing from that earlier call could be reused for the actual
 * download anyway, and this command is already a deferred, human-latency-bound interaction.
 * Best-effort: returns `[]` on any yt-dlp/parse failure rather than throwing (a picker with no
 * options is handled gracefully by the caller; a thrown probe error would abort the command).
 */
export async function listSubtitleTracksForYtdlp(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<SubtitleCandidate[]> {
  const args = buildSubtitleEnumerationArgs(source);
  const { stdout, stderr, exitCode } = await runSubprocess(
    [config.ytDlpPath, ...args],
    signal,
  );
  if (exitCode !== 0) {
    log.warn("subtitle enumeration failed", {
      target: ytdlpTarget(source),
      stderr: stderr.trim().slice(-500),
    });
    return [];
  }
  let info: YtdlpInfo;
  try {
    info = parseYtdlpInfo(stdout);
  } catch (error) {
    log.warn("could not parse yt-dlp subtitle enumeration output", {
      error: getErrorMessage(error),
    });
    return [];
  }
  return listYtdlpSubtitleCandidates(
    info.subtitles ?? {},
    info.automatic_captions ?? {},
    config.subtitles.includeAutoGenerated,
  );
}

/**
 * Parse `yt-dlp --list-extractors` stdout into supported source names. yt-dlp prints one name per
 * line; entries it tags ` (CURRENTLY BROKEN)` are dropped (they won't actually stream), as are
 * blank lines.
 */
export function parseExtractors(stdout: string): string[] {
  const names: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.endsWith("(CURRENTLY BROKEN)")) {
      continue;
    }
    names.push(line);
  }
  return names;
}

let extractorCache: readonly string[] | undefined;

/** Argument list for the extractor listing behind `/stream sources`. Needs no network. */
export function buildExtractorListArgs(): string[] {
  return [IGNORE_HOST_CONFIG, "--list-extractors"];
}

/**
 * The source/site names yt-dlp can extract (`yt-dlp --list-extractors`), backing `/stream sources`.
 * Memoized for the process lifetime — the set only changes when yt-dlp itself is upgraded, which
 * implies a restart. Throws on a non-zero exit so the caller can surface a clear error.
 */
export async function listExtractors(
  config: Config,
  signal: AbortSignal,
): Promise<readonly string[]> {
  if (extractorCache !== undefined) {
    return extractorCache;
  }
  const { stdout, stderr, exitCode } = await runSubprocess(
    [config.ytDlpPath, ...buildExtractorListArgs()],
    signal,
  );
  if (exitCode !== 0) {
    throw new Error(
      `yt-dlp --list-extractors failed (code ${String(exitCode)}): ${stderr.trim()}`,
    );
  }
  const names = parseExtractors(stdout);
  extractorCache = names;
  return names;
}
