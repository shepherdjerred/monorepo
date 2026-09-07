/**
 * Deciding whether a queued item is *music* or *video* — which is the same thing as deciding which
 * Discord transport carries it. Music goes out audio-only over the userbot's normal voice
 * connection (the green mic ring); video goes out over Go Live. Both belong to the same userbot in
 * the same channel, so the choice is per-item and a queue may alternate freely.
 *
 * Everything here is pure and I/O-free on purpose. Each signal is gathered by the caller (yt-dlp
 * metadata, an ffprobe result, the user's own `mode:`) and handed in, so the decision is a table
 * that can be exhaustively tested rather than a judgement buried in the resolve path.
 */

import { z } from "zod";

/**
 * What the *user* asked for. `auto` — also what a request that omits `mode` means — defers to the
 * classifier below; `music`/`video` are explicit overrides for when it gets an item wrong.
 */
export const MediaModeSchema = z.enum(["auto", "music", "video"]);
export type MediaMode = z.infer<typeof MediaModeSchema>;

/**
 * What an item actually resolved to. Deliberately narrower than {@link MediaModeSchema}: there is
 * no `auto` here, because every resolved item has already committed to one transport and the
 * streamer must never have to re-decide (or default) at play time.
 */
export const MediaKindSchema = z.enum(["music", "video"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/**
 * Which rule below produced the answer. Returned alongside the kind — and not merely logged —
 * because a misclassification is otherwise undiagnosable after the fact: yt-dlp's signed URLs
 * expire, so nobody can re-run the same resolve later and see what we saw. `categories` covers
 * both directions (a `Music` category and a non-`Music` one are equally strong evidence).
 */
export type MediaKindDecidedBy =
  | "no-video-stream"
  | "mode"
  | "categories"
  | "track-tags"
  | "extractor"
  | "provider-default"
  | "default";

export type MediaKindDecision = {
  readonly kind: MediaKind;
  readonly decidedBy: MediaKindDecidedBy;
};

/**
 * How much the caller's {@link MediaKindInput.hasVideoStream} observation is actually worth.
 *
 * Resolution asks yt-dlp for audio first (`-f bestaudio/best`) so that the common case — a song —
 * costs exactly one subprocess. That makes "the selected stream carries no picture" *trivially*
 * true for every item, song or movie alike, so rule 1 is suppressed on that pass. Were it not,
 * every URL in the queue would classify as music and the video transport would never be reached.
 *
 * `"video"` means the observation describes the media itself rather than a deliberately-narrowed
 * slice of it: the merged result of the video pass, or a local file's ffprobe, which reads the
 * whole container. There a missing video stream is a real fact about the item and rule 1 applies.
 */
export type MediaKindPass = "audio-first" | "video";

/**
 * Every signal the classifier looks at. The yt-dlp-derived fields accept `null` as well as
 * `undefined` because yt-dlp populates them per-extractor and freely emits explicit nulls — both
 * mean the same thing here ("no signal"), and normalising at the call site would only spread the
 * same check across every caller.
 */
export type MediaKindInput = {
  /** The user's explicit `/stream play mode:` choice; `auto` (the schema default) defers to us. */
  readonly mode?: MediaMode | undefined;
  /**
   * Whether the media demonstrably carries a picture — from ffprobe for a local file, or from the
   * codecs of the format(s) yt-dlp actually selected for a URL. `undefined` means "not known yet",
   * which is different from `false`: only a definite `false` triggers rule 1, and only on a pass
   * where a `false` means anything (see {@link MediaKindPass}).
   */
  readonly hasVideoStream?: boolean | undefined;
  /** yt-dlp `categories` (YouTube's own category, e.g. `["Music"]`, `["Gaming"]`). */
  readonly categories?: readonly string[] | null | undefined;
  /** yt-dlp `track`/`artist` — populated only on auto-generated/topic music uploads. */
  readonly track?: string | null | undefined;
  readonly artist?: string | null | undefined;
  /** yt-dlp `extractor_key`, e.g. `"Youtube"`, `"Soundcloud"`. */
  readonly extractorKey?: string | null | undefined;
  /** The provenance provider the resolver settled on, for the per-provider default. */
  readonly provider?: "local" | "youtube" | "url" | undefined;
};

/**
 * yt-dlp `extractor_key` prefixes for sites that only ever publish audio. Matched as a
 * case-insensitive *prefix* because one site fans out into several keys (`Soundcloud`,
 * `SoundcloudSet`, `SoundcloudUser`, …) and the casing is yt-dlp's own (`"Youtube"`, not
 * `"YouTube"`).
 *
 * This list is a shortcut, not the safety net. A link to any of these sites also selects a format
 * with no video track, so rule 1 catches it on the video pass; the rule exists so the *audio-first*
 * pass — where rule 1 is deliberately blind — still lands on `music` without a second subprocess.
 */
const AUDIO_ONLY_EXTRACTOR_PREFIXES = [
  "soundcloud",
  "bandcamp",
  "mixcloud",
  "audiomack",
  "audius",
  "jamendo",
] as const;

/** True for a metadata string yt-dlp actually populated (it omits keys and emits nulls freely). */
function hasText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().length > 0;
}

function isAudioOnlyExtractor(
  extractorKey: string | null | undefined,
): boolean {
  if (extractorKey === null || extractorKey === undefined) {
    return false;
  }
  const normalized = extractorKey.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    AUDIO_ONLY_EXTRACTOR_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  );
}

/**
 * Reduce `categories` to a two-sided signal. A `Music` category says music; *any other* non-empty
 * category says video, and says it strongly enough to outrank the per-provider default below — a
 * YouTube item tagged `Gaming` is evidence, whereas a YouTube item with no categories at all is
 * only an absence. An empty/missing list yields no signal.
 */
function categorySignal(
  categories: readonly string[] | null | undefined,
): MediaKind | undefined {
  if (
    categories === null ||
    categories === undefined ||
    categories.length === 0
  ) {
    return undefined;
  }
  return categories.some(
    (category) => category.trim().toLowerCase() === "music",
  )
    ? "music"
    : "video";
}

/**
 * The last word on rule 1, applied once the FINAL ffmpeg input has been probed by ffprobe.
 *
 * This is where the guard {@link classifyMediaKind} gives up on the audio-first pass comes back. An
 * explicit `mode: "video"` on a source with no picture (a SoundCloud link) survives classification
 * — rule 2 honours the override, and rule 1 was blind on that pass — and the video selector's
 * `/best` tail then lands on an audio-only format. Probing that chosen input is the first moment
 * anything can see the truth, and it has to be seen HERE: the fork's `attachPipeline` hard-throws
 * `"No video stream in media"` on a video-typed play with no video track, *after* ffmpeg has
 * spawned and the Go Live connection has been opened. There is no fallback on that side and none is
 * wanted; the contract is to fail loudly, so the catch has to happen before it.
 *
 * Only ever downgrades video -> music, never the reverse. A probe that FINDS a picture says nothing
 * about whether the item is a song — the metadata pass already weighed every signal that does — so
 * agreement returns `undefined`, meaning "the existing decision stands".
 */
export type MediaKindReconciliation =
  /** The probe disagreed with an INFERRED video classification; trust the probe. */
  | { readonly outcome: "demote"; readonly decision: MediaKindDecision }
  /**
   * The caller explicitly asked for video and the input has no picture. Not demotable: `"video"`
   * here was a deliberate instruction — from a user typing `mode:video`, or from the rollout flag
   * forcing the pre-split transport — and quietly playing it as music would ignore both. The
   * rollout case is the one that matters: silently falling back is a flag that does not switch the
   * feature off.
   */
  | { readonly outcome: "unsupported" };

export function reconcileMediaKind(
  classified: MediaKind,
  hasVideoStream: boolean | undefined,
  requestedMode: MediaMode | undefined,
): MediaKindReconciliation | undefined {
  if (classified !== "video" || hasVideoStream !== false) return undefined;
  if (requestedMode === "video") return { outcome: "unsupported" };
  return {
    outcome: "demote",
    decision: { kind: "music", decidedBy: "no-video-stream" },
  };
}

/**
 * Classify one item. First matching rule wins; the ordering is the whole design, so it is spelled
 * out inline rather than left to be reconstructed from the code.
 */
export function classifyMediaKind(
  input: MediaKindInput,
  pass: MediaKindPass,
): MediaKindDecision {
  // 1. No picture at all beats every INFERRED signal: the fork's `attachPipeline` hard-throws on a
  //    video-typed play with no video track, so guessing video for (say) a SoundCloud link would be
  //    a guaranteed crash. It deliberately does NOT beat an explicit `mode: "video"` — that is an
  //    instruction, from a user or from the rollout flag forcing the pre-split transport, and
  //    quietly playing it as music would ignore both. `reconcileMediaKind` reports that
  //    combination as unsupported instead, so it fails with a reason rather than a silent switch.
  //    Suppressed on the audio-first pass, where the answer is `false` for every item by
  //    construction — see MediaKindPass.
  if (
    pass === "video" &&
    input.hasVideoStream === false &&
    input.mode !== "video"
  ) {
    return { kind: "music", decidedBy: "no-video-stream" };
  }
  // 2. An explicit override beats every inferred signal — that is what it is for.
  if (input.mode === "music" || input.mode === "video") {
    return { kind: input.mode, decidedBy: "mode" };
  }
  const category = categorySignal(input.categories);
  // 3. The uploader's own category is the most direct statement of intent we get.
  if (category === "music") {
    return { kind: "music", decidedBy: "categories" };
  }
  // 4. `track`/`artist` are only populated on auto-generated/topic music uploads, which are
  //    unambiguously songs even when the category is missing.
  if (hasText(input.track) || hasText(input.artist)) {
    return { kind: "music", decidedBy: "track-tags" };
  }
  // 5. Some sites host nothing but audio; the extractor name alone settles it.
  if (isAudioOnlyExtractor(input.extractorKey)) {
    return { kind: "music", decidedBy: "extractor" };
  }
  // 6. A stated non-music category (talks, gaming, entertainment) outranks the provider default.
  //    Without this, YouTube's music-leaning default below would swallow every talk and let-s-play.
  if (category === "video") {
    return { kind: "video", decidedBy: "categories" };
  }
  // 7. Provider default. YouTube leans music: the overwhelming majority of what gets queued from it
  //    is listened to rather than watched, and getting it wrong costs a full video encode plus a
  //    Go Live connection to carry a still image.
  if (input.provider === "youtube") {
    return { kind: "music", decidedBy: "provider-default" };
  }
  // 8. Everything else — arbitrary links, the local library — is video, as it was before this split.
  return { kind: "video", decidedBy: "default" };
}
