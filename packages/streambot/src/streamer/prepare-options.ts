import { Encoders, Utils } from "@shepherdjerred/discord-video-stream";
import type { PrepareStreamOptions } from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  PipelineMode,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import { httpHeaderInputOptions } from "@shepherdjerred/streambot/sources/format-select.ts";

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
    // `readrate` carries over: an unpaced demux outruns the send loop and grows the buffer pool
    // until GC pauses it, and that shape is identical whatever the bitrate.
    //
    // `readrateInitialBurst` deliberately does NOT. On Go Live the burst pre-rolls a cushion into
    // the receiver's jitter buffer, and it was tuned against real ffmpeg output there. This
    // transport is different in the way that matters: `attachPipeline` makes the lone AudioStream
    // `noSleep` for the burst window, so 2.5 s would push ~125 Opus packets back-to-back down the
    // ordinary voice connection before pacing starts — a burst onto a path whose behaviour nobody
    // has measured, on the very first audio a listener hears. This package's rule is to profile
    // real output before changing timing or buffers; until someone has, the safe default is the
    // paced one. Enable it here once there is a live measurement to point at.
    readrate: input.stream.readrate,
    ...startTimeOption(input.startSeconds),
    ...headerOptions(input.resolved.ffmpegInputHeaders),
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
  return {
    width: stream.width,
    height: stream.height,
    frameRate: stream.fps,
    bitrateVideo: stream.bitrateKbps,
    bitrateVideoMax: stream.bitrateKbps * 2,
    bitrateAudio: stream.bitrateAudioKbps,
    includeAudio: true,
    videoCodec: Utils.normalizeVideoCodec("H264"),
    hardwareAcceleratedDecoding: useHardware,
    minimizeLatency: false,
    // Bound ffmpeg's input demux to a multiple of realtime. Without this, a fast GPU encoder
    // runs the source at 3-5× realtime and the NUT-pipe consumer cannot drain that fast,
    // causing the downstream JS buffer pool to grow at ~25 MB/s until major GC pauses the
    // send loop ≥ 200 ms and the Discord receiver's jitter buffer shows a ~1 s freeze.
    readrate: stream.readrate,
    // Pre-roll this many seconds at full speed before readrate pacing engages. The play-side
    // pacer (readrateInitialBurst below) forwards the pre-roll into the receiver's jitter
    // buffer, which absorbs transient production dips on heavy-bitrate scenes — without it the
    // realtime-paced pipeline has zero margin and every dip stutters playback.
    readrateInitialBurst: stream.readrateInitialBurst,
    // The gain ffmpeg's output `volume` filter starts at. Unity renders as the literal `1.0`, which
    // is byte-identical to the value this filter always carried, so a 100% segment emits exactly
    // the command line it did before this option existed.
    audioVolume: Math.max(0, input.volumePercent) / 100,
    ...startTimeOption(input.startSeconds),
    ...(resolved.subtitle
      ? { subtitleBurn: { path: resolved.subtitle.path } }
      : {}),
    // HDR sources get tonemapped to BT.709 SDR by the pipeline (tonemap_vaapi on the GPU path,
    // a zimg chain on the software path) — without it, PQ/HLG content looks washed out.
    inputColor: resolved.hdr === true ? ("hdr" as const) : ("sdr" as const),
    ...(useHardware
      ? { encoder: Encoders.vaapi({ device: stream.vaapiDevice }) }
      : {}),
    // "hw-upload": GPU decode to system memory + hwupload back onto the device for the GPU
    // filters/encode — the recovery pipeline for sources whose mid-stream hwaccel flip crashes
    // the full-GPU graph (ffmpeg exit 218). See PipelineMode.
    ...(input.pipelineMode === "hw-upload"
      ? { hardwarePipelineMode: "upload" as const }
      : {}),
    ...headerOptions(resolved.ffmpegInputHeaders),
    ...(resolved.audioInput === undefined
      ? {}
      : {
          audioInput: {
            source: resolved.audioInput,
            // A merge result's audio URL is signed separately and carries its own header set;
            // there is no shared top-level `http_headers` to inherit.
            inputOptions: httpHeaderInputOptions(resolved.audioInputHeaders),
          },
        }),
  };
}
