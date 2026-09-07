/**
 * Which `-f` selector each media kind asks yt-dlp for, and how the headers yt-dlp hands back become
 * ffmpeg input options.
 *
 * The one thing this file deliberately does NOT do is choose a URL. yt-dlp's own selector engine
 * already knows about HLS-vs-DASH, `m3u8_native`, per-format `http_headers`, DRM, and codec
 * preference ordering; reimplementing that over the `formats[]` array means re-deriving all of it
 * and re-deriving it again on every yt-dlp upgrade. So: we state what we want with `-f`, yt-dlp
 * picks, and `ytdlp.ts` reads back what it picked.
 *
 * This replaces `-f best` ("the best single file containing both video and audio"), which was
 * quietly broken. Measured against yt-dlp 2026.08.19, YouTube publishes almost no muxed formats any
 * more, and both sample videos below failed outright with "Requested format is not available":
 *
 *     yt-dlp -f best   https://www.youtube.com/watch?v=lYBUbBu4W08   -> exit 1
 *     yt-dlp -f best   https://www.youtube.com/watch?v=8aGhZQkoFbQ   -> exit 1
 *
 * Production runs plain yt-dlp with no cookies or PO tokens (`Dockerfile`), so that failure was
 * live for a large share of YouTube.
 *
 * Pure and I/O-free: the strings below are the whole contract, which is what makes them worth
 * asserting character-for-character in the tests.
 */

import type { MediaKind } from "@shepherdjerred/streambot/sources/media-kind.ts";

/**
 * The refinement message `YtdlpInfoSchema` attaches when a payload carries neither `url` nor
 * `requested_formats`. Exported so `ytdlp.ts` can recognise ITS OWN failure among Zod's issues and
 * re-throw it as a {@link NoUsableFormatError} — matching a constant we wrote, not yt-dlp phrasing
 * that drifts between versions.
 */
export const NO_PLAYABLE_FORMAT_ISSUE =
  "yt-dlp returned neither a media url nor requested_formats; nothing to play";

/**
 * Thrown when yt-dlp exits cleanly but selected nothing we can hand ffmpeg — every branch of the
 * selector missed, including its `/best` tail. Deliberately fatal rather than degraded: there is no
 * "close enough" stream, and a silent fallback would surface as an unexplained black screen or
 * silence mid-queue. `discord/resolve.ts` recognises the class (not the message) to turn it into a
 * specific reply, and the message below reads acceptably after `classifyPlayError`'s generic
 * "Couldn't queue that:" prefix if it ever reaches that bucket instead.
 */
export class NoUsableFormatError extends Error {
  readonly kind: MediaKind;
  constructor(kind: MediaKind, detail: string) {
    super(
      `yt-dlp selected no playable ${kind === "music" ? "audio" : "video"} stream ` +
        `for this item (${detail})`,
    );
    this.name = "NoUsableFormatError";
    this.kind = kind;
  }
}

export type FormatSelectorOptions = {
  readonly kind: MediaKind;
  /**
   * `config.stream.height` — the Go Live output height. Applied as a soft cap so yt-dlp prefers a
   * source no taller than what we will actually transmit, instead of fetching 2160p to scale it to
   * 720p. Ignored for music, which has no picture to cap.
   */
  readonly maxHeight: number;
};

/**
 * The `-f` expression for an item of this kind.
 *
 * **music** — `bestaudio/best`. The `/best` tail is load-bearing, not decoration: a source that
 * publishes no audio-only format at all (a direct `.mp4`, an HLS master) would otherwise fail with
 * the very "Requested format is not available" this change exists to remove. The audio pipeline's
 * `-vn` then discards the picture from that muxed stream, which costs bytes but plays.
 *
 * **video** — four branches, tried in order:
 *  1. `bestvideo[vcodec^=avc1][height<=?H]+bestaudio` — H.264 first, deliberately. The bare
 *     `bestvideo+bestaudio` selector picks **AV1** (`av01.0.04M.08`) on YouTube today, and the
 *     video path encodes through VAAPI H264; handing it AV1 forces a software decode of a codec
 *     the GPU cannot help with.
 *  2. `bestvideo[height<=?H]+bestaudio` — any video codec, for a source that publishes no H.264.
 *  3. `best` — the muxed single file, for a source that publishes no split formats at all.
 *  4. `bestaudio` — the graceful landing for a source with no picture anywhere (a SoundCloud link
 *     reached with `mode: "video"`). This tail is NOT redundant with `best`: `best` means "the best
 *     format containing BOTH video and audio", which is the exact semantics behind the `-f best`
 *     bug this file exists to fix, so on a genuinely audio-only source branch 3 errors out too.
 *     Without this tail the whole selector fails with "Requested format is not available" instead
 *     of degrading. What comes back is then audio-only, which `classifyMediaKind` sees on the video
 *     pass (and `resolveSource`'s ffprobe confirms) and downgrades to music.
 *
 * `height<=?H` is yt-dlp's *soft* comparison (the `?`): a source whose every format is taller than
 * the cap still matches rather than failing the branch, so the cap never turns a playable item into
 * an error. Verified on both sample videos above: this selector yields
 * `requested_formats: [136 avc1.4d401f 720p, 251 opus]` and **no top-level `url`**.
 */
export function buildFormatSelector(options: FormatSelectorOptions): string {
  if (options.kind === "music") {
    return "bestaudio/best";
  }
  const cap = `[height<=?${String(options.maxHeight)}]`;
  return (
    `bestvideo[vcodec^=avc1]${cap}+bestaudio/` +
    `bestvideo${cap}+bestaudio/` +
    `best/` +
    `bestaudio`
  );
}

/**
 * Render one format's `http_headers` as ffmpeg input options.
 *
 * ffmpeg takes the whole set as a single CRLF-joined `-headers` value, which is the same encoding
 * the fork applies to `prepareStream`'s `customHeaders` for input 0. This exists for the *second*
 * input: a split video play has two separately-signed URLs, each with its own headers, and the
 * fork's `audioInput.inputOptions` is the only place per-input options can be attached.
 *
 * Returns `[]` for an empty header set so the caller can spread it unconditionally — an empty
 * `-headers ""` is not the same thing as no `-headers` at all.
 */
export function httpHeaderInputOptions(
  headers: Readonly<Record<string, string>> | undefined,
): string[] {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) {
    return [];
  }
  return [
    "-headers",
    entries.map(([name, value]) => `${name}: ${value}`).join("\r\n"),
  ];
}
