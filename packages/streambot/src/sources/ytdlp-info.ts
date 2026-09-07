/**
 * The shape of a `yt-dlp --dump-json` answer, and what it maps to.
 *
 * Split out of `ytdlp.ts` so the two halves stay separable: this file is pure — schema, parsing,
 * and the mapping from "what yt-dlp said it picked" to ffmpeg inputs and a {@link ResolvedSource} —
 * while `ytdlp.ts` is the half that actually runs the binary. Everything here is directly testable
 * against a captured payload, with no subprocess in the way.
 *
 * The `formats[]` array is deliberately NOT modelled anywhere below. Selection happens inside
 * yt-dlp via `-f` (see `format-select.ts` for why), so the only formats worth reading back are the
 * ones yt-dlp says it chose: the top-level fields for a single format, `requested_formats` for a
 * `+` merge.
 */

import { z } from "zod";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { toChapters } from "@shepherdjerred/streambot/sources/chapters.ts";
import {
  classifyMediaKind,
  type MediaKind,
  type MediaKindDecision,
  type MediaKindPass,
  type MediaMode,
} from "@shepherdjerred/streambot/sources/media-kind.ts";
import {
  NoUsableFormatError,
  NO_PLAYABLE_FORMAT_ISSUE,
} from "@shepherdjerred/streambot/sources/format-select.ts";
import { parseJson } from "@shepherdjerred/streambot/util/errors.ts";

// yt-dlp's `subtitles`/`automatic_captions` dict entries carry `ext`/`url` too, but those are
// deliberately NOT modeled here — the `url` is signed/time-limited, and burning always
// re-converts to SRT anyway, so `name` (for menu labels) is all this schema needs.
const YtdlpSubtitleTrackSchema = z.object({ name: z.string().optional() });

/** yt-dlp's per-request HTTP headers for a format, verbatim (User-Agent, Referer, Cookie, …). */
const YtdlpHttpHeadersSchema = z.record(z.string(), z.string());
type HttpHeaders = Readonly<Record<string, string>>;

/**
 * One entry of `requested_formats` — the formats yt-dlp actually chose to satisfy a `+` merge
 * selector, in the order it would feed them to ffmpeg (video first, then audio).
 *
 * `format_id` and `url` are REQUIRED here, unlike in the full `formats[]` listing: an entry yt-dlp
 * committed to downloading always has both, so one that doesn't is a broken contract and should
 * fail the parse rather than be quietly skipped. `http_headers` is per-entry and load-bearing —
 * a split play has two separately-signed URLs, and there is no top-level `http_headers` on a merge
 * result to fall back on (verified against 2026.08.19).
 */
const YtdlpRequestedFormatSchema = z.object({
  format_id: z.string().min(1),
  url: z.string().min(1),
  vcodec: z.string().nullish(),
  acodec: z.string().nullish(),
  height: z.number().nullish(),
  ext: z.string().nullish(),
  tbr: z.number().nullish(),
  http_headers: YtdlpHttpHeadersSchema.optional(),
});

/**
 * The slice of one `yt-dlp --dump-json` output line we rely on. yt-dlp emits a large object; Zod
 * keeps the fields we trust and drops the rest, so a schema drift can't smuggle unknown shapes in.
 *
 * The `formats[]` array is deliberately NOT modelled. Selection happens inside yt-dlp via `-f`
 * (see `format-select.ts` for why), so the only formats this file cares about are the ones yt-dlp
 * says it picked — the top-level fields for a single format, `requested_formats` for a merge.
 */
export const YtdlpInfoSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1),
    /**
     * Direct media URL of the ONE format yt-dlp selected. Optional, because a `+` merge selector
     * emits no top-level `url` at all — the two chosen formats appear in `requested_formats`
     * instead (verified against 2026.08.19). The refinement below asserts that at least one of the
     * two is present, so "yt-dlp told us nothing playable" fails at the boundary rather than
     * surfacing later as an ffmpeg error against `undefined`.
     */
    url: z.string().min(1).optional(),
    /** Codecs of that single selected format. `"none"` is yt-dlp's sentinel for "no such track". */
    vcodec: z.string().nullish(),
    acodec: z.string().nullish(),
    /** Headers for the single selected `url`. Absent on a merge, which carries them per-entry. */
    http_headers: YtdlpHttpHeadersSchema.optional(),
    /** The formats behind a `+` merge selector: video first, then audio, each with its own URL. */
    requested_formats: z.array(YtdlpRequestedFormatSchema).nullish(),
    /** Classifier signals. All per-extractor, so all nullish — YouTube sets `categories` on every
     * video but `track`/`artist`/`album` only on auto-generated (topic) music uploads. `album` is
     * modelled for the now-playing card rather than for classification. */
    categories: z.array(z.string()).nullish(),
    track: z.string().nullish(),
    artist: z.string().nullish(),
    album: z.string().nullish(),
    extractor_key: z.string().nullish(),
    duration: z.number().optional(),
    is_live: z.boolean().optional(),
    webpage_url: z.string().optional(),
    uploader: z.string().optional(),
    channel: z.string().optional(),
    thumbnail: z.string().optional(),
    // Chapter markers (e.g. YouTube timestamps); yt-dlp gives seconds as numbers.
    chapters: z
      .array(
        z.object({
          start_time: z.number(),
          end_time: z.number().optional(),
          title: z.string().optional(),
        }),
      )
      .nullish(),
    // Available subtitle tracks, keyed by language — used only for `/stream subtitles`'s picker.
    subtitles: z
      .record(z.string(), z.array(YtdlpSubtitleTrackSchema))
      .optional(),
    automatic_captions: z
      .record(z.string(), z.array(YtdlpSubtitleTrackSchema))
      .optional(),
  })
  .refine(
    (info) =>
      info.url !== undefined || (info.requested_formats ?? []).length > 0,
    { message: NO_PLAYABLE_FORMAT_ISSUE },
  );

/**
 * True when a Zod failure is specifically OUR "nothing playable" refinement rather than a genuine
 * shape mismatch. The two want different user-facing replies — "that item has no video stream I can
 * play" versus a generic parse failure — and only this one is a normal, reachable outcome.
 */
export function isNoPlayableFormatIssue(error: unknown): boolean {
  return (
    error instanceof z.ZodError &&
    error.issues.some((issue) => issue.message === NO_PLAYABLE_FORMAT_ISSUE)
  );
}

export type YtdlpInfo = z.infer<typeof YtdlpInfoSchema>;

/** yt-dlp's sentinel for "this format genuinely carries no track of this type". */
const NO_CODEC = "none";

/**
 * yt-dlp's codec fields are TRI-state, and collapsing them to a boolean is a real misclassification
 * bug rather than a style question:
 *
 * - `"none"`          — the format definitely carries no track of this type.
 * - `null` / absent   — the extractor did not say. archive.org serving a plain `.mp3` reports
 *                       `vcodec: null`, NOT `"none"` (verified against 2026.08.19).
 * - anything else     — a real codec.
 *
 * A rule written `vcodec === "none"` therefore reads that mp3 as "has video", routes it to Go Live,
 * and ffmpeg dies on `-map 0:v`. The two predicates below keep the unknown case separate, and
 * {@link selectedHasVideoStream} propagates it as `undefined` rather than resolving it either way.
 */
function isRealCodec(codec: string | null | undefined): boolean {
  return codec !== null && codec !== undefined && codec !== NO_CODEC;
}

/** True only for yt-dlp's explicit "no track here" sentinel — never for an unknown codec. */
function isAbsentCodec(codec: string | null | undefined): boolean {
  return codec === NO_CODEC;
}

/** Parse yt-dlp stdout into validated info (JSON → unknown → Zod). */
export function parseYtdlpInfo(stdout: string): YtdlpInfo {
  return YtdlpInfoSchema.parse(parseJson(stdout));
}

/**
 * Whether the format(s) yt-dlp actually selected carry a picture, or `undefined` when it did not
 * say. This is the URL-side source of {@link classifyMediaKind}'s `hasVideoStream` — and it is only
 * meaningful on the video pass, because the audio-first pass asks for audio and therefore always
 * gets `false`. See `MediaKindPass`.
 */
export function selectedHasVideoStream(info: YtdlpInfo): boolean | undefined {
  const requested = info.requested_formats ?? [];
  if (requested.length > 0) {
    if (requested.some((format) => isRealCodec(format.vcodec))) {
      return true;
    }
    // Only an explicit `"none"` on EVERY entry is a denial. A merge whose entries left `vcodec`
    // unset says nothing, and answering `false` there would be the tri-state collapse described
    // above — with the video transport as the casualty.
    return requested.every((format) => isAbsentCodec(format.vcodec))
      ? false
      : undefined;
  }
  if (isRealCodec(info.vcodec)) {
    return true;
  }
  return isAbsentCodec(info.vcodec) ? false : undefined;
}

/**
 * The ffmpeg input(s) yt-dlp's chosen format(s) map to, with each input's own HTTP headers.
 * `audioInput` is set only for the split case, where video and audio are two separately-signed URLs.
 */
export type StreamInputs = {
  readonly ffmpegInput: string;
  readonly ffmpegInputHeaders?: Readonly<Record<string, string>>;
  readonly audioInput?: string;
  readonly audioInputHeaders?: Readonly<Record<string, string>>;
  /** yt-dlp's ids for the inputs above, in the same order — the only trace of what it picked. */
  readonly formatIds: readonly string[];
};

/**
 * Read back what yt-dlp selected. Two response shapes, neither a fallback for the other:
 *
 * - a `+` merge answers in `requested_formats` (video entry + audio entry, no top-level `url`),
 * - every other selection answers with a single top-level `url` plus its codecs and headers.
 */
type PrimaryInput = Pick<StreamInputs, "ffmpegInput" | "ffmpegInputHeaders">;
type SecondaryInput = Pick<StreamInputs, "audioInput" | "audioInputHeaders">;

/** ffmpeg input 0 and its headers, omitting the header key entirely when there are none. */
function primaryInput(
  url: string,
  headers: HttpHeaders | undefined,
): PrimaryInput {
  return {
    ffmpegInput: url,
    ...(headers === undefined ? {} : { ffmpegInputHeaders: headers }),
  };
}

/** ffmpeg input 1 (audio) and its own, separately-signed headers. */
function secondaryInput(
  url: string,
  headers: HttpHeaders | undefined,
): SecondaryInput {
  return {
    audioInput: url,
    ...(headers === undefined ? {} : { audioInputHeaders: headers }),
  };
}

export function toStreamInputs(info: YtdlpInfo, kind: MediaKind): StreamInputs {
  const requested = info.requested_formats ?? [];
  const video = requested.find((format) => isRealCodec(format.vcodec));
  const audio = requested.find(
    (format) => !isRealCodec(format.vcodec) && isRealCodec(format.acodec),
  );
  if (video !== undefined && audio !== undefined) {
    return {
      ...primaryInput(video.url, video.http_headers),
      ...secondaryInput(audio.url, audio.http_headers),
      formatIds: [video.format_id, audio.format_id],
    };
  }
  // A merge selector that resolved to a single entry (one branch matched only video, or only
  // audio). One input, no `-map 1:a:0`.
  const single = video ?? audio ?? requested[0];
  if (single !== undefined) {
    return {
      ...primaryInput(single.url, single.http_headers),
      formatIds: [single.format_id],
    };
  }
  if (info.url !== undefined) {
    return { ...primaryInput(info.url, info.http_headers), formatIds: [] };
  }
  // Unreachable through `parseYtdlpInfo`, whose refinement already rejects a payload with neither
  // shape. Kept because `YtdlpInfo` is also constructible in tests and by future callers, and a
  // broken internal contract must fail loudly rather than reach ffmpeg as `undefined`.
  throw new NoUsableFormatError(kind, "no url and no requested_formats");
}

/** The provenance provider a yt-dlp result maps to, which is also a classifier signal. */
function ytdlpProvider(info: YtdlpInfo): "youtube" | "url" {
  return info.webpage_url?.includes("youtube.com") === true ? "youtube" : "url";
}

/**
 * Decide music-vs-video for a yt-dlp result. Split out of {@link toResolvedSource} so
 * {@link resolveWithYtdlp} can log *why* an item was classified the way it was: yt-dlp's signed
 * URLs expire, so nobody can re-run the same resolve later to find out.
 */
export function classifyYtdlpInfo(
  info: YtdlpInfo,
  mode: MediaMode | undefined,
  pass: MediaKindPass,
): MediaKindDecision {
  return classifyMediaKind(
    {
      mode,
      hasVideoStream: selectedHasVideoStream(info),
      categories: info.categories,
      track: info.track,
      artist: info.artist,
      extractorKey: info.extractor_key,
      provider: ytdlpProvider(info),
    },
    pass,
  );
}

export type ToResolvedSourceOptions = {
  /** The kind {@link classifyYtdlpInfo} settled on for the pass that produced `info`. */
  readonly mediaKind: MediaKind;
};

/**
 * Map validated yt-dlp info to a {@link ResolvedSource} ffmpeg can read. `info` must come from the
 * pass matching `options.mediaKind` — a music kind read off an audio selection, a video kind off a
 * video selection — because the inputs below are simply whatever that pass selected.
 */
export function toResolvedSource(
  info: YtdlpInfo,
  options: ToResolvedSourceOptions,
): ResolvedSource {
  const channel = info.channel ?? info.uploader;
  const inputs = toStreamInputs(info, options.mediaKind);
  return {
    title: info.title,
    ffmpegInput: inputs.ffmpegInput,
    mediaKind: options.mediaKind,
    ...(inputs.ffmpegInputHeaders === undefined
      ? {}
      : { ffmpegInputHeaders: inputs.ffmpegInputHeaders }),
    ...(inputs.audioInput === undefined
      ? {}
      : { audioInput: inputs.audioInput }),
    ...(inputs.audioInputHeaders === undefined
      ? {}
      : { audioInputHeaders: inputs.audioInputHeaders }),
    ...(info.duration === undefined ? {} : { durationSeconds: info.duration }),
    chapters: toChapters(
      (info.chapters ?? []).map((chapter) => ({
        startSeconds: chapter.start_time,
        endSeconds: chapter.end_time ?? null,
        title: chapter.title ?? null,
      })),
    ),
    provenance: {
      provider: ytdlpProvider(info),
      ...(info.webpage_url === undefined
        ? {}
        : { canonicalUrl: info.webpage_url }),
      ...(channel === undefined ? {} : { channel }),
      ...(info.thumbnail === undefined ? {} : { thumbnailUrl: info.thumbnail }),
    },
  };
}
