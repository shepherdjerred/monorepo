import {
  Encoders,
  Utils,
  fitWithin,
} from "@shepherdjerred/discord-video-stream";
import type { PrepareStreamOptions } from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  PipelineMode,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import { httpHeaderInputOptions } from "@shepherdjerred/streambot/sources/format-select.ts";

/** A fixed playback slot must never silently switch Discord transports. */
export function assertPlaybackTransport(
  actual: ResolvedSource["mediaKind"],
  expected: ResolvedSource["mediaKind"] | undefined,
): void {
  if (expected !== undefined && actual !== expected)
    throw new Error(`Playback transport mismatch: expected ${expected}`);
}

/**
 * The ffmpeg options one segment runs with, built as two pure functions of the resolved item.
 *
 * Pure because the alternative — assembling them inline in `streamOnce` — makes every assertion
 * about them require a `StreambotStreamer`, a config, a fake player factory and a running actor.
 * The interesting properties are all local: that a music segment carries no encoder, that a video
 * segment's arguments did not move, that the volume actually reaches ffmpeg. Those are worth
 * testing directly rather than through four layers of harness.
 */
export type PrepareOptionsInput = {
  readonly stream: Config["stream"];
  readonly resolved: ResolvedSource;
  /** Offset (seconds) this attempt starts at; `0` for a fresh play. */
  readonly startSeconds: number;
  /** Desired playback volume as a percentage (0-200), as the machine holds it. */
  readonly volumePercent: number;
};

/** Video-only extras: the encoder ladder position this attempt is on. */
export type VideoPrepareOptionsInput = PrepareOptionsInput & {
  readonly pipelineMode: PipelineMode;
};

/** Transport is fixed by the resolved source before either player is constructed. */
export function buildPlaybackPrepareOptions(
  input: VideoPrepareOptionsInput,
): Partial<PrepareStreamOptions> {
  if (input.resolved.ffmpegInput === undefined)
    throw new Error("Deferred sports input must be prepared before streaming");
  return input.resolved.mediaKind === "music"
    ? buildMusicPrepareOptions(input)
    : buildVideoPrepareOptions(input);
}

function startTimeOption(startSeconds: number): { startTime?: number } {
  return startSeconds > 0 ? { startTime: startSeconds } : {};
}

function headerOptions(headers: ResolvedSource["ffmpegInputHeaders"]): {
  customHeaders?: Record<string, string>;
} {
  return headers === undefined ? {} : { customHeaders: { ...headers } };
}

/**
 * Music: audio only, over the normal voice connection.
 *
 * Everything the video path needs and this one does not is simply absent, not set to a neutral
 * value — `prepareStream({ audioOnly: true })` ignores the sizing options and hard-throws on the
 * five that could only have been asked for deliberately (`subtitleBurn`, `noTranscoding`,
 * `includeAudio: false`, `pad`, `inputColor: "hdr"`). The practical payoff of omitting the encoder
 * is that `-init_hw_device vaapi=…` is never emitted, so a host without `/dev/dri` runs a song
 * without ffmpeg failing at startup.
 *
 * No `audioVolume`. Gain for a music segment lives in the mixer, where it can change mid-track;
 * setting it here as well would apply the user's volume twice.
 */
export function buildMusicPrepareOptions(
  input: PrepareOptionsInput,
): Partial<PrepareStreamOptions> {
  return {
    audioOnly: true,
    includeAudio: true,
    bitrateAudio: input.stream.bitrateAudioKbps,
    // `readrate` carries over on seekable media: an unpaced demux outruns the send loop and grows
    // the buffer pool until GC pauses it, and that shape is identical whatever the bitrate. Omit
    // it on live sources (`resolved.live === true`), where ffmpeg warns `-readrate` can drop
    // packets.
    //
    // `readrateInitialBurst` deliberately does NOT carry over. On Go Live the burst pre-rolls a
    // cushion into the receiver's jitter buffer, and it was tuned against real ffmpeg output there.
    // This transport is different in the way that matters: `attachPipeline` makes the lone
    // AudioStream `noSleep` for the burst window, so 2.5 s would push ~125 Opus packets
    // back-to-back down the ordinary voice connection before pacing starts — a burst onto a path
    // whose behaviour nobody has measured, on the very first audio a listener hears. This
    // package's rule is to profile real output before changing timing or buffers; until someone
    // has, the safe default is the paced one. Enable it here once there is a live measurement to
    // point at.
    ...(input.resolved.live === true
      ? {}
      : { readrate: input.stream.readrate }),
    ...startTimeOption(input.startSeconds),
    ...headerOptions(input.resolved.ffmpegInputHeaders),
    ...(input.resolved.ffmpegInputOptions === undefined
      ? {}
      : { customInputOptions: [...input.resolved.ffmpegInputOptions] }),
  };
}

/**
 * Video: unchanged from what this package has always sent to Go Live, plus two additions.
 *
 * `audioInput` carries the second ffmpeg input for a yt-dlp `+` merge result, which is the normal
 * case on YouTube now that muxed formats have all but disappeared. `audioVolume` makes the
 * long-standing "volume set for the next video" reply true for the first time: it was previously a
 * promise about a value nothing ever passed.
 */
export function buildVideoPrepareOptions(
  input: VideoPrepareOptionsInput,
): Partial<PrepareStreamOptions> {
  const { stream, resolved } = input;
  const useHardware = input.pipelineMode !== "sw";
  const size = outputSize(stream, resolved);
  return {
    width: size.width,
    height: size.height,
    frameRate: outputFrameRate(stream, resolved),
    ...(resolved.probedVideo?.interlaced === true ? { deinterlace: true } : {}),
    ...(needsBt709Conversion(resolved) ? { convertColorToBt709: true } : {}),
    bitrateVideo: stream.bitrateKbps,
    bitrateVideoMax: stream.bitrateKbps * 2,
    bitrateAudio: stream.bitrateAudioKbps,
    includeAudio: true,
    videoCodec: Utils.normalizeVideoCodec("H264"),
    hardwareAcceleratedDecoding: useHardware,
    minimizeLatency: false,
    // Bound ffmpeg's input demux to a multiple of realtime on seekable media. Without this, a fast
    // GPU encoder runs the source at 3-5× realtime and the NUT-pipe consumer cannot drain that
    // fast, causing the downstream JS buffer pool to grow at ~25 MB/s until major GC pauses the
    // send loop ≥ 200 ms and the Discord receiver's jitter buffer shows a ~1 s freeze. Pre-rolling
    // `readrateInitialBurst` seconds at full speed before pacing engages lets the play-side pacer
    // forward a cushion into the receiver's jitter buffer for transient production dips.
    //
    // Omit both on live sources (`resolved.live === true`), where ffmpeg warns `-readrate` can
    // cause packet loss and non-`.m3u8` live manifests (such as ClearKey DASH `.mpd`) are not
    // caught by `prepareStream`'s URL filename check.
    ...(resolved.live === true
      ? {}
      : {
          readrate: stream.readrate,
          readrateInitialBurst: stream.readrateInitialBurst,
        }),
    // The gain ffmpeg's output `volume` filter starts at. Unity renders as the literal `1.0`, which
    // is byte-identical to the value this filter always carried, so a 100% segment emits exactly
    // the command line it did before this option existed.
    audioVolume: Math.max(0, input.volumePercent) / 100,
    ...(resolved.discontinuousLive === true
      ? { normalizeTimestamps: true }
      : startTimeOption(input.startSeconds)),
    ...(resolved.subtitle
      ? { subtitleBurn: { path: resolved.subtitle.path } }
      : {}),
    // HDR sources get tonemapped to BT.709 SDR by the pipeline (tonemap_vaapi on the GPU path,
    // a zimg chain on the software path) — without it, PQ/HLG content looks washed out.
    inputColor: resolved.hdr === true ? ("hdr" as const) : ("sdr" as const),
    ...(useHardware
      ? { encoder: Encoders.vaapi({ device: stream.vaapiDevice }) }
      : {}),
    // Discontinuous live input can change decoded frame format at an ad boundary, so keep its
    // decoder output in system memory from the first attempt; scaling and encoding stay on GPU.
    //
    // A rotated source (phone video) takes the same route: ffmpeg only autorotates software
    // frames, so decoding straight into VAAPI surfaces would send the picture sideways.
    ...(input.pipelineMode === "hw-upload" ||
    (useHardware &&
      (resolved.discontinuousLive === true || isRotated(resolved)))
      ? { hardwarePipelineMode: "upload" as const }
      : {}),
    ...headerOptions(resolved.ffmpegInputHeaders),
    ...(resolved.ffmpegInputOptions === undefined
      ? {}
      : { customInputOptions: [...resolved.ffmpegInputOptions] }),
    ...(resolved.ffmpegVideoStreamIndex === undefined
      ? {}
      : { videoStreamIndex: resolved.ffmpegVideoStreamIndex }),
    ...(resolved.ffmpegAudioStreamIndex === undefined
      ? {}
      : { audioStreamIndex: resolved.ffmpegAudioStreamIndex }),
    ...(resolved.audioInput === undefined
      ? {}
      : {
          audioInput: {
            source: resolved.audioInput,
            // A merge result's audio URL is signed separately and carries its own header set;
            // there is no shared top-level `http_headers` to inherit.
            inputOptions: [
              ...httpHeaderInputOptions(resolved.audioInputHeaders),
              ...(resolved.audioInputOptions ?? []),
            ],
          },
        }),
  };
}

/**
 * The encoded picture size: the source's display aspect fitted inside the configured box, so a
 * 2.39:1 film encodes at 1920x804 rather than being stretched to 1920x1080, and a portrait clip
 * at 608x1080. Discord letterboxes a non-16:9 stream itself, so no padding is encoded and the GPU
 * and software pipelines size identically. A source whose probe failed keeps the configured box.
 */
function outputSize(
  stream: Pick<Config["stream"], "width" | "height">,
  resolved: Pick<ResolvedSource, "probedVideo">,
): { width: number; height: number } {
  const box = { width: stream.width, height: stream.height };
  return resolved.probedVideo === undefined
    ? box
    : fitWithin(resolved.probedVideo.displayAspect, box);
}

function isRotated(resolved: Pick<ResolvedSource, "probedVideo">): boolean {
  const rotation = resolved.probedVideo?.rotation;
  return rotation !== undefined && rotation !== 0;
}

/** Film, PAL and NTSC rates and their doubles: the cadences a source can be played back at exactly. */
const STANDARD_FRAME_RATES = [
  24_000 / 1001,
  24,
  25,
  30_000 / 1001,
  30,
  48_000 / 1001,
  48,
  50,
  60_000 / 1001,
  60,
  100,
  120_000 / 1001,
  120,
] as const;

/** 23.976 and 24 differ by 0.1%, so recognising a rate must be tighter than that. */
const FRAME_RATE_MATCH_TOLERANCE = 0.0005;

/** NTSC sits 0.1% under its integer rate, so a cap that close still counts as fitting. */
const CAP_TOLERANCE = 0.002;

/**
 * The rate a video segment is encoded at — `-r`, the GPU subtitle canvas, and the rate Discord is
 * told all read this one value. `stream.fps` is a cap, not a forced rate: forcing 30 made a
 * 23.976 film judder (a 3:2 duplicate cadence) and halved 50/60p sport. The source's own rate
 * plays when it fits under the cap; a faster source plays at the largest whole fraction of its
 * rate that does (60 → 30, 50 → 25), so frames are dropped evenly rather than in a beat.
 *
 * Only a recognised standard rate is followed. ffprobe's average for a variable-rate phone or
 * screen recording is an arbitrary number, and an unprobed source has none; both keep the cap,
 * which is exactly the forced rate every segment used before.
 */
export function outputFrameRate(
  stream: Pick<Config["stream"], "fps">,
  resolved: Pick<ResolvedSource, "probedVideo">,
): number {
  const source = resolved.probedVideo?.frameRate;
  if (source === undefined) return stream.fps;
  const standard = STANDARD_FRAME_RATES.find(
    (rate) => Math.abs(rate - source) / rate < FRAME_RATE_MATCH_TOLERANCE,
  );
  if (standard === undefined) return stream.fps;
  // A cap within 0.2% of the source counts as fitting, so a configured 29.97 does not halve a
  // 30 fps source.
  const divisor = Math.max(
    1,
    Math.ceil(standard / (stream.fps * (1 + CAP_TOLERANCE))),
  );
  return standard / divisor;
}

/** ffprobe `color_space` values that mean the BT.601 matrix (625-line and 525-line). */
const BT601_MATRICES = new Set(["bt470bg", "smpte170m"]);

/**
 * Convert to BT.709 limited range when the source is tagged as something else we can convert:
 * a BT.601 matrix (SD material, which would otherwise be decoded with HD coefficients after the
 * upscale and shift hue), or full range on a tagged BT.709 matrix. Untagged sources are left
 * alone: both scalers assume BT.601 for an untagged frame, which would wrongly "convert" the
 * untagged HD majority. HDR is already tonemapped to BT.709.
 */
function needsBt709Conversion(
  resolved: Pick<ResolvedSource, "probedVideo" | "hdr">,
): boolean {
  const video = resolved.probedVideo;
  if (video === undefined || resolved.hdr === true) return false;
  const colorSpace = video.colorSpace ?? "";
  return (
    BT601_MATRICES.has(colorSpace) ||
    (colorSpace === "bt709" && video.colorRange === "pc")
  );
}

/**
 * Go Live play options. The burst and the playout ceiling travel together (see the call site in
 * the streamer). A live source also gets its rebuffer cushion; seekable media does not, because
 * its pacer catches up after a dip by reading ahead, which a live input cannot do.
 */
export function buildGoLivePlayOptions(
  stream: Pick<
    Config["stream"],
    "readrateInitialBurst" | "videoPlayoutDelayMaxMs" | "liveBufferMs" | "fps"
  >,
  resolved: Pick<ResolvedSource, "live" | "probedVideo">,
) {
  return {
    type: "go-live" as const,
    // The rate Discord's video attributes advertise: the encoded rate, stated rather than read
    // back from the demuxed stream's codec parameters.
    frameRate: outputFrameRate(stream, resolved),
    readrateInitialBurst: stream.readrateInitialBurst,
    videoPlayoutDelayMaxMs: stream.videoPlayoutDelayMaxMs,
    ...(resolved.live === true ? { liveBufferMs: stream.liveBufferMs } : {}),
  };
}
