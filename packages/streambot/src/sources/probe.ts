/**
 * Best-effort `ffprobe` of a resolved source so its media properties (video/audio codec, resolution,
 * HDR, channels) are visible at runtime. There was no probing before this — during the 2026-06-07
 * stutter incident the source being a 2160p HEVC 10-bit remux with a lossless TrueHD track was
 * completely invisible. This never throws and never blocks playback: a probe failure logs a warning
 * and returns `null`.
 */

import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";
import { httpHeaderInputOptions } from "@shepherdjerred/streambot/sources/format-select.ts";
import type {
  ProbedAudio,
  ProbedVideo,
  RankedTracks,
  VideoRotation,
} from "@shepherdjerred/streambot/sources/probed-media.ts";
import { languageScore } from "@shepherdjerred/streambot/sources/subtitles.ts";

const log = logger.child("probe");

/** Hard cap so probing a slow/remote input can never wedge the resolve step. */
const PROBE_TIMEOUT_MS = 15_000;

function contentKeyValues(inputOptions: readonly string[]): string[] {
  const values: string[] = [];
  const sensitive = new Set([
    "-cenc_decryption_key",
    "-decryption_key",
    "-decryption_keys",
    "-seg_format_options",
  ]);
  for (const [index, option] of inputOptions.entries()) {
    const name = option.split("=", 1)[0] ?? "";
    if (!sensitive.has(name)) continue;
    const separator = option.indexOf("=");
    const value =
      separator === -1 ? inputOptions[index + 1] : option.slice(separator + 1);
    if (value === undefined || value.length === 0) continue;
    values.push(value);
    if (name === "-seg_format_options")
      values.push(
        ...[
          ...value.matchAll(/(?:^|:)(?:cenc_)?decryption_key=([^:]+)/gu),
        ].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
      );
  }
  return values;
}

export function redactProbeError(
  message: string,
  input: string,
  inputOptions: readonly string[] = [],
  headers: Readonly<Record<string, string>> = {},
): string {
  let redacted = message
    .replaceAll(input, "[redacted media URL]")
    .replaceAll(/https?:\/\/[^\s"'<>]+/g, "[redacted URL]");
  const headerValues = Object.entries(headers).flatMap(([name, value]) =>
    /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-streambot-media-session)$/iu.test(
      name,
    ) && value.length > 0
      ? [value]
      : [],
  );
  for (const secret of [...contentKeyValues(inputOptions), ...headerValues])
    redacted = redacted.replaceAll(secret, "<redacted>");
  return redacted;
}

/** An optional field whose present-but-mistyped value reads as absent instead of failing the parse. */
function tolerant<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value): z.output<T> | undefined => {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    })
    .optional();
}

const StreamSchema = z.object({
  codec_type: z.string().optional(),
  /**
   * ffprobe reports embedded cover art as a `video` stream carrying `attached_pic: 1`. It is a
   * single still frame, not a picture to play — treating it as video routes an MP3 with album
   * artwork through a full Go Live encode instead of the audio path, which is the opposite of
   * what the transport classifier is for.
   */
  disposition: z
    .object({
      attached_pic: z.number().optional(),
      // Track-ranking inputs. Each tolerates an unexpected type on its own (`.catch`), so a quirky
      // tag cannot null the whole probe and take the transport classifier down with it.
      default: tolerant(z.number()),
      comment: tolerant(z.number()),
      visual_impaired: tolerant(z.number()),
    })
    .optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  pix_fmt: z.string().optional(),
  color_transfer: z.string().optional(),
  color_space: z.string().optional(),
  color_range: z.string().optional(),
  /** `N:M`; `0:1` (or absent) means ffprobe does not know, which players treat as square. */
  sample_aspect_ratio: z.string().optional(),
  /** `progressive`, `tt`/`bb`/`tb`/`bt` (interlaced), or `unknown`. */
  field_order: z.string().optional(),
  /** Rational strings such as `24000/1001`; `0/0` when unknown. */
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  /** Legacy rotation tag (clockwise degrees) written by older muxers. */
  tags: z
    .object({
      rotate: z.string().optional(),
      language: tolerant(z.string()),
      title: tolerant(z.string()),
      /** HLS master `BANDWIDTH`, as a decimal string. */
      variant_bitrate: tolerant(z.string()),
    })
    .optional(),
  /** The display matrix's `rotation` is counter-clockwise degrees, e.g. `-90` for most phone clips. */
  side_data_list: z
    .array(z.object({ rotation: z.number().optional() }))
    .optional(),
  channels: z.number().optional(),
  channel_layout: z.string().optional(),
});

type ProbedStream = z.infer<typeof StreamSchema>;

const FfprobeOutputSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  format: z.object({ duration: z.string().optional() }).optional(),
});

export type MediaInfo = {
  videoCodec: string;
  /** Zero-based index among video streams, for sources with multiple renditions. */
  videoStreamIndex?: number;
  width: number | undefined;
  height: number | undefined;
  pixelFormat: string | undefined;
  hdr: boolean;
  audioCodec: string;
  /** Zero-based index among audio streams, for sources with multiple renditions. */
  audioStreamIndex?: number;
  audioChannels: number | undefined;
  durationSeconds: number | undefined;
  /** Display properties of the selected video stream; absent when it has no usable dimensions. */
  video?: ProbedVideo;
  /** Layout of the selected audio stream; absent when the source has no audio. */
  audio?: ProbedAudio;
  /** What `streambot-audio-track-ranking-enabled` would play instead of the fields above. */
  ranked: RankedTracks;
};

/** Inputs to track ranking that come from configuration rather than from the media. */
export type TrackPreferences = {
  /** Preferred languages, best first; the subtitle language preference. */
  readonly languages: readonly string[];
  /** Output box height; taller variants are chosen only when none fits. */
  readonly maxVideoHeight?: number;
};

/** Map a pixel height to a coarse, bounded resolution label (keeps `streambot_source_info` low-card). */
export function resolutionBucket(height?: number): string {
  if (height === undefined) return "unknown";
  if (height >= 2000) return "2160p";
  if (height >= 1400) return "1440p";
  if (height >= 1000) return "1080p";
  return height >= 600 ? "720p" : "sd";
}

/** Parse an ffprobe rational (`24000/1001`, `16:9`); undefined unless both terms are positive. */
function parseRatio(value: string | undefined): number | undefined {
  const match = value === undefined ? null : /^(\d+)[/:](\d+)$/u.exec(value);
  if (match === null) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? numerator / denominator : undefined;
}

const QUARTER_TURNS = [
  0, 90, 180, 270,
] as const satisfies readonly VideoRotation[];

/** Clockwise quarter-turns from the display matrix (CCW degrees) or, failing that, the legacy tag. */
function videoRotation(stream: ProbedStream): VideoRotation {
  const matrix = stream.side_data_list?.find(
    (entry) => entry.rotation !== undefined,
  )?.rotation;
  const legacy = Number(stream.tags?.rotate ?? 0);
  const clockwise =
    matrix === undefined ? (Number.isFinite(legacy) ? legacy : 0) : -matrix;
  const quarterTurns = ((Math.round(clockwise / 90) % 4) + 4) % 4;
  return QUARTER_TURNS[quarterTurns] ?? 0;
}

const INTERLACED_FIELD_ORDERS = new Set(["tt", "bb", "tb", "bt"]);

function probedVideo(stream: ProbedStream): ProbedVideo | undefined {
  const { width, height } = stream;
  if (width === undefined || height === undefined || width <= 0 || height <= 0)
    return undefined;
  const pixelAspect = parseRatio(stream.sample_aspect_ratio) ?? 1;
  const rotation = videoRotation(stream);
  const storedAspect = (width * pixelAspect) / height;
  const frameRate =
    parseRatio(stream.avg_frame_rate) ?? parseRatio(stream.r_frame_rate);
  return {
    displayAspect:
      rotation === 90 || rotation === 270 ? 1 / storedAspect : storedAspect,
    rotation,
    ...(frameRate === undefined ? {} : { frameRate }),
    interlaced: INTERLACED_FIELD_ORDERS.has(stream.field_order ?? ""),
    ...(stream.color_space === undefined
      ? {}
      : { colorSpace: stream.color_space }),
    ...(stream.color_range === undefined
      ? {}
      : { colorRange: stream.color_range }),
  };
}

function probedAudio(stream: ProbedStream): ProbedAudio {
  return {
    ...(stream.channels === undefined ? {} : { channels: stream.channels }),
    ...(stream.channel_layout === undefined
      ? {}
      : { channelLayout: stream.channel_layout }),
  };
}

/** ffprobe `color_transfer` values that denote HDR (PQ / HLG). */
export function isHdrTransfer(transfer?: string): boolean {
  return transfer === "smpte2084" || transfer === "arib-std-b67";
}

/** A track whose title or disposition marks it as commentary or audio description. */
const SECONDARY_AUDIO_TITLE =
  /commentary|descriptive|audio description|described video/iu;

function isSecondaryAudio(stream: ProbedStream): boolean {
  return (
    stream.disposition?.comment === 1 ||
    stream.disposition?.visual_impaired === 1 ||
    SECONDARY_AUDIO_TITLE.test(stream.tags?.title ?? "")
  );
}

/**
 * The audio track a viewer most likely wants: the muxer's default, then the preferred language,
 * then the most channels, never a commentary or description track while a main track exists.
 * Ties keep stream order. Undefined only when no audio stream reports channels.
 */
function rankAudio(
  audios: readonly ProbedStream[],
  languages: readonly string[],
): number | undefined {
  const usable = audios.flatMap((stream, index) =>
    (stream.channels ?? 0) > 0 ? [{ stream, index }] : [],
  );
  const main = usable.filter(({ stream }) => !isSecondaryAudio(stream));
  const pool = main.length > 0 ? main : usable;
  return pool.toSorted(
    (a, b) =>
      Number(b.stream.disposition?.default === 1) -
        Number(a.stream.disposition?.default === 1) ||
      languageScore(a.stream.tags?.language ?? null, languages) -
        languageScore(b.stream.tags?.language ?? null, languages) ||
      (b.stream.channels ?? 0) - (a.stream.channels ?? 0) ||
      a.index - b.index,
  )[0]?.index;
}

function variantBitrate(stream: ProbedStream): number {
  const bitrate = Number(stream.tags?.variant_bitrate);
  return Number.isFinite(bitrate) ? bitrate : 0;
}

/**
 * The video variant worth decoding: the tallest that fits the output box (a taller one is scaled
 * straight back down), else the shortest above it, then the highest advertised bitrate. Ties keep
 * stream order. Undefined only when no video stream reports dimensions.
 */
function rankVideo(
  videos: readonly ProbedStream[],
  maxHeight: number | undefined,
): ProbedStream | undefined {
  const sized = videos.filter(
    (stream) => (stream.width ?? 0) > 0 && (stream.height ?? 0) > 0,
  );
  const fits = (stream: ProbedStream) =>
    maxHeight === undefined || (stream.height ?? 0) <= maxHeight;
  return sized
    .map((stream, index) => ({ stream, index }))
    .toSorted((a, b) => {
      const aFits = fits(a.stream);
      const bFits = fits(b.stream);
      const aHeight = a.stream.height ?? 0;
      const bHeight = b.stream.height ?? 0;
      return (
        Number(bFits) - Number(aFits) ||
        (aFits ? bHeight - aHeight : aHeight - bHeight) ||
        variantBitrate(b.stream) - variantBitrate(a.stream) ||
        a.index - b.index
      );
    })[0]?.stream;
}

function rankedTracks(
  videoStreams: readonly ProbedStream[],
  videos: readonly ProbedStream[],
  audios: readonly ProbedStream[],
  preferences: TrackPreferences,
): RankedTracks {
  const audioIndex = rankAudio(audios, preferences.languages);
  const audio = audioIndex === undefined ? undefined : audios[audioIndex];
  const video = rankVideo(videos, preferences.maxVideoHeight);
  const displayed = video === undefined ? undefined : probedVideo(video);
  return {
    ...(audioIndex === undefined || audio === undefined
      ? {}
      : { audioStreamIndex: audioIndex, audio: probedAudio(audio) }),
    ...(video === undefined || displayed === undefined
      ? {}
      : {
          videoStreamIndex: videoStreams.indexOf(video),
          video: displayed,
          hdr: isHdrTransfer(video.color_transfer),
        }),
  };
}

function finiteSeconds(raw: string | undefined): number | undefined {
  const seconds = raw === undefined ? undefined : Number(raw);
  return seconds !== undefined && Number.isFinite(seconds)
    ? seconds
    : undefined;
}

const NO_PREFERENCES: TrackPreferences = { languages: [] };

/** Parse ffprobe's `-show_streams -show_format` JSON into a {@link MediaInfo}; null if it doesn't validate. */
export function parseFfprobeOutput(
  json: unknown,
  preferences: TrackPreferences = NO_PREFERENCES,
): MediaInfo | null {
  const parsed = FfprobeOutputSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const videoStreams = parsed.data.streams.filter(
    (stream) => stream.codec_type === "video",
  );
  const videos = videoStreams.filter(
    (stream) => stream.disposition?.attached_pic !== 1,
  );
  const audios = parsed.data.streams.filter(
    (stream) => stream.codec_type === "audio",
  );
  const videoStreamIndex = videos.findIndex(
    (stream) => (stream.width ?? 0) > 0 && (stream.height ?? 0) > 0,
  );
  const audioStreamIndex = audios.findIndex(
    (stream) => (stream.channels ?? 0) > 0,
  );
  const selectedVideoIndex = Math.max(0, videoStreamIndex);
  const selectedAudioIndex = Math.max(0, audioStreamIndex);
  const video = videos[selectedVideoIndex];
  const audio = audios[selectedAudioIndex];
  const displayed = video === undefined ? undefined : probedVideo(video);
  return {
    videoCodec: video?.codec_name ?? "unknown",
    ...(video === undefined
      ? {}
      : { videoStreamIndex: videoStreams.indexOf(video) }),
    width: video?.width,
    height: video?.height,
    pixelFormat: video?.pix_fmt,
    hdr: isHdrTransfer(video?.color_transfer),
    audioCodec: audio?.codec_name ?? "unknown",
    ...(audio === undefined ? {} : { audioStreamIndex: selectedAudioIndex }),
    audioChannels: audio?.channels,
    durationSeconds: finiteSeconds(parsed.data.format?.duration),
    ...(displayed === undefined ? {} : { video: displayed }),
    ...(audio === undefined ? {} : { audio: probedAudio(audio) }),
    ranked: rankedTracks(videoStreams, videos, audios, preferences),
  };
}

/**
 * Run ffprobe on `input` and return parsed media info, or null on any failure (missing binary,
 * non-zero exit, timeout, unparseable output, abort). Honors `signal` and an internal timeout.
 *
 * `headers` carries yt-dlp's per-format `http_headers` (User-Agent, Referer, Cookie, …). Without
 * them a signed CDN URL answers 403 and the probe silently returns null, which costs more than the
 * source-info metric: `resolveSource` uses this probe as the authoritative "does it have a picture"
 * check that keeps an audio-only source with `mode: "video"` from reaching the fork's hard throw,
 * and that check is only as good as the probe's ability to actually fetch the input.
 */
export async function probeMedia(
  config: Config,
  input: string,
  signal?: AbortSignal,
  options?: {
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly inputOptions?: readonly string[] | undefined;
  },
): Promise<MediaInfo | null> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const abort =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  try {
    const { stdout, stderr, exitCode } = await runSubprocess(
      [
        config.ffprobePath,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        ...(options?.inputOptions ?? []),
        ...httpHeaderInputOptions(options?.headers),
        input,
      ],
      abort,
    );
    // Drain stdout AND stderr concurrently. If stderr were only read on failure, a chatty ffprobe
    // could fill the (~64 KB) pipe buffer and block before closing stdout, hanging the stdout read.
    if (exitCode !== 0) {
      log.warn("ffprobe exited non-zero", {
        exitCode,
        stderr: redactProbeError(
          stderr.trim(),
          input,
          options?.inputOptions,
          options?.headers,
        ),
      });
      return null;
    }
    return parseFfprobeOutput(JSON.parse(stdout), {
      languages: config.subtitles.languages,
      maxVideoHeight: config.stream.height,
    });
  } catch (error) {
    log.warn("ffprobe failed", {
      error: redactProbeError(
        getErrorMessage(error),
        input,
        options?.inputOptions,
        options?.headers,
      ),
    });
    return null;
  }
}
