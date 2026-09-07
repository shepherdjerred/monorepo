import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import pDebounce from "p-debounce";
import { createRequire as __createRequire } from "node:module";
import Log from "debug-level";

// Lazy-load sharp: it is only used by the optional streamPreview path. Loading it eagerly forces a
// native dlopen that fails on some bun/global-cache layouts. The module name is built at runtime so
// the bundler cannot statically pre-resolve (and therefore eagerly load) it. Previously a committed
// bun patch in the consumer packages; baked into source here.
const __require = __createRequire(import.meta.url);
// sharp 0.35 ships ESM-first types: the callable factory is the DEFAULT export
// of the module type, while the CJS require() below still returns the callable
// directly at runtime.
type SharpFactory = (typeof import("sharp"))["default"];
let __sharpModule: SharpFactory | undefined;
const __sharpName = ["sh", "arp"].join("");
const sharp = ((
  ...args: Parameters<SharpFactory>
): ReturnType<SharpFactory> => {
  const factory: SharpFactory =
    __sharpModule ?? (__sharpModule = __require(__sharpName));
  return factory(...args);
}) as SharpFactory;
import { type Packet, AV_PKT_FLAG_KEY } from "node-av";
import { PassThrough, type Readable } from "node:stream";
import { demux } from "./LibavDemuxer.js";
import { VideoStream } from "./VideoStream.js";
import { AudioStream } from "./AudioStream.js";
import { isBun, isDeno, isFiniteNonZero } from "../utils.js";
import { AVCodecID } from "./LibavCodecId.js";
import { createDecoder } from "./LibavDecoder.js";
import { Encoders } from "./encoders/index.js";
import { buildSoftwareVideoGraph } from "./videoGraph.js";

import type { AudioFrameSink } from "./AudioSink.js";
import type { Request } from "zeromq";
import type { SupportedVideoCodec } from "../utils.js";
import type { Streamer } from "../client/index.js";
import type { EncoderSettingsGetter } from "./encoders/index.js";
import type { VideoStreamInfo } from "./LibavDemuxer.js";
import type { WebRtcConnWrapper } from "../client/voice/WebRtcWrapper.js";
import type {
  FfmpegCodecData,
  FfmpegProgress,
  StreamObserver,
} from "./StreamObserver.js";

export type PrepareStreamOptions = {
  /**
   * Disable video transcoding
   * If enabled, all video related settings have no effects, and the input
   * video stream is used as-is.
   *
   * You need to ensure that the video stream has the right properties
   * (keyframe every 1s, B-frames disabled). Failure to do so will result in
   * a glitchy stream, or degraded performance
   */
  noTranscoding: boolean;

  /**
   * Video width
   */
  width: number;

  /**
   * Video height
   */
  height: number;

  /**
   * Video frame rate
   */
  frameRate?: number;

  /**
   * Video codec
   */
  videoCodec: SupportedVideoCodec;

  /**
   * Video average bitrate in kbps
   */
  bitrateVideo: number;

  /**
   * Video max bitrate in kbps
   */
  bitrateVideoMax: number;

  /**
   * Audio bitrate in kbps
   */
  bitrateAudio: number;

  /**
   * Enable audio output
   */
  includeAudio: boolean;

  /**
   * Produce an audio-only stream: no video mapping, no encoder, no filter graph, no decode
   * options. The video sizing settings (`width`/`height`/`frameRate`/`videoCodec`/`bitrateVideo`/
   * `encoder`/`hardwareAcceleratedDecoding`) are ignored, so a host with no `/dev/dri` never emits
   * a VAAPI device init for a stream that has no picture to encode.
   *
   * The audio mapping also becomes REQUIRED (`-map 0:a:0`, without the optional `?` the video path
   * uses): a source with no audio track is a broken contract here, and failing at ffmpeg startup is
   * far better than producing an empty NUT that hangs the demuxer forever.
   *
   * Throws when combined with any of `subtitleBurn`, `noTranscoding`, `includeAudio: false`, `pad`,
   * or `inputColor: "hdr"`. Each is a request that cannot mean anything without a picture, and
   * discarding one silently is the soft failure this codebase does not allow: the caller believes
   * it asked for something and gets no signal that it did not happen. The sizing settings above are
   * *ignored* rather than rejected because they carry defaults every caller inherits without asking
   * for them; these five are only ever set deliberately.
   *
   * Off by default; every emitted argument of a video stream is unchanged.
   */
  audioOnly: boolean;

  /**
   * Gain applied by the output `volume` filter, as a linear multiplier (`1` = unity, `0.5` = half
   * amplitude, `0` = silence). Replaces the hardcoded `1.0` this filter always carried — the filter
   * instance exists for the (Node-only) zmq control path, but its initial value was never settable,
   * so a caller that knew its desired volume up front had no way to say so.
   */
  audioVolume: number;

  /**
   * Functions to get encoder settings
   * This function will receive the average and max bitrate as the input, and
   * returns an object containing encoder settings for the supported codecs
   */
  encoder: EncoderSettingsGetter;

  /**
   * Enable hardware accelerated decoding
   */
  hardwareAcceleratedDecoding: boolean;

  /**
   * How decoded frames travel into the filter graph when a full hardware pipeline is active
   * (`hardwareAcceleratedDecoding` + an encoder with `hwPipeline`).
   *
   * - `"full"` (default): the decoder emits GPU surfaces (`-hwaccel_output_format`) and the whole
   *   graph runs on hardware frames. Fastest, but if the decoder flips its hwaccel state
   *   mid-stream (seen on some HEVC remuxes) ffmpeg ≤7.1 cannot renegotiate the hardware-only
   *   graph and dies with "Impossible to convert between the formats" (exit 218).
   * - `"upload"`: the decoder still decodes on the GPU but emits system-memory frames, and the
   *   graph starts with `hwupload` — scale/tonemap/encode stay on the GPU at the cost of one
   *   PCIe round-trip per frame. Structurally immune to the mid-stream renegotiation bug (the
   *   graph input is always a software frame), so it serves as the recovery pipeline for sources
   *   that crash the `"full"` mode.
   *
   * Ignored when the full hardware pipeline is not active.
   */
  hardwarePipelineMode: "full" | "upload";

  /**
   * Add some options to minimize latency
   */
  minimizeLatency: boolean;

  /**
   * Flush the muxer's IO buffer after every packet (`-flush_packets 1` on the
   * container output). Removes output-side buffering tails for realtime
   * consumers. Off by default so VOD/throughput consumers keep ffmpeg's
   * auto-flush behavior. Do NOT pair with `-max_interleave_delta 0` — that
   * "low latency" folklore flag actually means *unbounded* interleave
   * buffering (measured 2026-08-03; no steady-state win with continuous
   * audio either).
   */
  lowLatencyMux: boolean;

  /**
   * Encode audio for realtime latency instead of the quality-first defaults:
   * libopus `-application lowdelay -frame_duration 10` (defaults are
   * `audio` / 20 ms). Trims ~10-16 ms from the audio pipeline and tightens
   * the receiver's A/V-sync window, at slightly higher container overhead
   * per second of audio. Off by default.
   */
  lowDelayAudio: boolean;

  /**
   * Custom headers for HTTP requests
   */
  customHeaders: Record<string, string>;

  /**
   * Cap ffmpeg's input read rate as a multiple of realtime. `1.0` matches realtime (equivalent to
   * `-re`); `2.0` reads twice as fast, etc. Use with seekable/pre-recorded sources to prevent the
   * encoder from running far ahead of the downstream RTP send loop — without this, a fast GPU
   * encoder can produce frames at 3-5× realtime, causing the NUT output to accumulate in the
   * consumer's JS-side buffers until V8/JSC major GC stop-the-world pauses the send loop. Maps to
   * ffmpeg's input `-readrate <value>` flag (added in 2021). Do NOT set when reading from a live
   * source / grab device — ffmpeg's own docs warn it can cause packet loss in that case.
   *
   * See https://ffmpeg.org/ffmpeg.html#:~:text=%2Dreadrate
   */
  readrate?: number;

  /**
   * Seconds of input to demux at full speed before `readrate` pacing engages (ffmpeg's
   * `-readrate_initial_burst`, default 0.5s). With `readrate: 1` the pipeline runs zero-margin —
   * production exactly matches the paced send loop, so any transient production dip immediately
   * starves the sender and stutters playback. A burst of a few seconds front-loads that much media
   * through the pipeline; pair it with {@link PlayStreamOptions.readrateInitialBurst} (same value)
   * so the send pacer forwards the pre-roll into the receiver's jitter buffer, which then absorbs
   * production dips while `readrate` lets ffmpeg catch back up to the wall-clock line.
   *
   * See https://ffmpeg.org/ffmpeg.html#:~:text=%2Dreadrate_initial_burst
   */
  readrateInitialBurst?: number;

  /**
   * Custom input options to pass directly to ffmpeg
   * These will be added to the command before other options
   */
  customInputOptions: string[];

  /**
   * Custom ffmpeg flags/options to pass directly to ffmpeg
   * These will be added to the command after other options
   */
  customFfmpegFlags: string[];

  /**
   * Override the ffmpeg executable. Defaults to `FFMPEG_PATH`, then `ffmpeg`.
   * Primarily useful for deployments with a nonstandard installation path and
   * deterministic process-level tests.
   */
  ffmpegPath?: string;

  /**
   * Burn this subtitle file into the video. The graph is composed by `prepareStream` itself: on
   * the GPU pipeline the subtitles are rendered by libass onto a transparent BGRA canvas,
   * uploaded, and composited with `overlay_vaapi` (the whole video path stays on the GPU); on the
   * software path a `subtitles=` burn is appended after any HDR tonemap. Either way the burn is
   * PTS-compensated for `startTime`, so cues stay correct across seeks. Incompatible with
   * `noTranscoding` (throws).
   */
  subtitleBurn?: { path: string };

  /**
   * Color/transfer characteristics of the input. `"hdr"` (PQ/HLG sources) inserts a tonemap to
   * BT.709 SDR — `tonemap_vaapi` on the GPU pipeline, a zimg/Hable chain on the software path —
   * without which HDR output looks washed out. Ignored (with a warning) when `noTranscoding` is
   * set. Default `"sdr"`.
   */
  inputColor: "sdr" | "hdr";

  /**
   * Start playback at this offset, in seconds (ffmpeg input `-ss` seek). Fast and accurate for
   * seekable inputs. Used by the seekable player to restart a source at a new position.
   */
  startTime?: number;

  /**
   * Optional observability seam. When supplied, the ffmpeg command line, input codec metadata, and
   * periodic transcode progress are forwarded to the observer. No effect on behavior.
   */
  observer?: StreamObserver;

  /**
   * Letterbox/pillarbox. After scaling the video to `width`x`height`, pad it onto a centered
   * black canvas of these dimensions. Use to emit a fixed aspect ratio (e.g. 16:9) for content
   * of a different aspect without stretching: set `width`/`height` to the aspect-correct content
   * box and `pad` to the final canvas. Software path only — the pad runs before any GPU `hwupload`,
   * so it composes with VAAPI raw-frame encoding; it is ignored when a hardware decode pipeline
   * (`hardwareAcceleratedDecoding` + an encoder with `hwPipeline`) is active.
   */
  pad?: { width: number; height: number };

  /**
   * Optional separate audio input. The primary `input` carries video; this carries audio out of a
   * second ffmpeg source, muxed into the output. Use for raw-video sources with no embedded audio
   * track (e.g. an emulator that emits BGRA frames and PCM samples on separate paths). When set, the
   * audio is mapped from this input (`-map 1:a:0`) instead of the primary input (`-map 0:a:0?`).
   * Requires `includeAudio: true` — otherwise it is ignored.
   *
   * `source` is an ffmpeg input *string* (path / FIFO / URL such as `tcp://127.0.0.1:9000`), NOT a
   * stream: the runner reserves stdin for a Readable primary `input`, so a second live stream must
   * reach ffmpeg over its own transport that the caller owns. `inputOptions` must fully describe
   * the raw format, e.g.
   * `["-f","s16le","-ar","44100","-ac","2"]`.
   */
  audioInput?: { readonly source: string; readonly inputOptions: string[] };
};

export type Controller = {
  volume: number;
  setVolume(newVolume: number): Promise<boolean>;
};

type FfmpegInput = {
  readonly source: string | Readable;
  readonly options: string[];
};

class FfmpegArgumentBuilder {
  readonly inputs: FfmpegInput[];
  readonly outputOptions: string[] = [];
  readonly videoFilters: string[] = [];
  readonly audioFilterChain: string[] = [];
  outputFormatName = "nut";

  constructor(input: string | Readable) {
    this.inputs = [{ source: input, options: [] }];
  }

  private get currentInput(): FfmpegInput {
    const input = this.inputs.at(-1);
    if (input === undefined) throw new Error("ffmpeg command has no input");
    return input;
  }

  input(source: string): this {
    this.inputs.push({ source, options: [] });
    return this;
  }

  inputOption(...options: string[]): this {
    this.currentInput.options.push(...options);
    return this;
  }

  inputOptions(options: readonly string[]): this {
    this.currentInput.options.push(...options);
    return this;
  }

  output(_stream: PassThrough): this {
    return this;
  }

  outputFormat(format: string): this {
    this.outputFormatName = format;
    return this;
  }

  addOptions(options: readonly string[]): this {
    this.outputOptions.push(...options);
    return this;
  }

  addOutputOption(option: string | readonly string[]): this {
    if (typeof option === "string") this.outputOptions.push(option);
    else this.outputOptions.push(...option);
    return this;
  }

  videoCodec(codec: string): this {
    this.outputOptions.push("-c:v", codec);
    return this;
  }

  videoFilter(filters: readonly string[]): this {
    this.videoFilters.push(...filters);
    return this;
  }

  complexFilter(graph: readonly string[], mapLabel: string): this {
    this.outputOptions.push(
      "-filter_complex",
      graph.join(";"),
      "-map",
      `[${mapLabel}]`,
    );
    return this;
  }

  fpsOutput(frameRate: number): this {
    this.outputOptions.push("-r", String(frameRate));
    return this;
  }

  outputOptionsList(options: readonly string[]): this {
    this.outputOptions.push(...options);
    return this;
  }

  audioChannels(channels: number): this {
    this.outputOptions.push("-ac", String(channels));
    return this;
  }

  audioFrequency(frequency: number): this {
    this.outputOptions.push("-ar", String(frequency));
    return this;
  }

  audioCodec(codec: string): this {
    this.outputOptions.push("-c:a", codec);
    return this;
  }

  audioBitrate(bitrate: string): this {
    this.outputOptions.push("-b:a", bitrate);
    return this;
  }

  audioFilters(filter: string): this {
    this.audioFilterChain.push(filter);
    return this;
  }

  arguments(): string[] {
    const inputArguments = this.inputs.flatMap((input, index) => [
      ...input.options,
      "-i",
      typeof input.source === "string"
        ? input.source
        : `pipe:${index.toString()}`,
    ]);
    return [
      ...inputArguments,
      ...this.outputOptions,
      ...(this.videoFilters.length > 0
        ? ["-filter:v", this.videoFilters.join(",")]
        : []),
      ...(this.audioFilterChain.length > 0
        ? ["-filter:a", this.audioFilterChain.join(",")]
        : []),
      "-progress",
      "pipe:2",
      "-nostats",
      "-f",
      this.outputFormatName,
      "pipe:1",
    ];
  }
}

export class FfmpegProcessHandle {
  readonly args: readonly string[];
  readonly #process: ChildProcessWithoutNullStreams;

  constructor(
    args: readonly string[],
    process: ChildProcessWithoutNullStreams,
  ) {
    this.args = Object.freeze([...args]);
    this.#process = process;
  }

  get pid(): number | undefined {
    return this.#process.pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    return this.#process.kill(signal);
  }
}

/**
 * Rejection type of {@link prepareStream}'s `promise` when ffmpeg itself fails (as opposed to an
 * abort). Carries the parsed exit code and a bounded tail of ffmpeg's stderr — the actual error
 * lines (e.g. filter-graph negotiation failures), not just the final "Conversion failed!".
 */
export class FfmpegExitError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: readonly string[];
  readonly startTimeSeconds: number | undefined;

  constructor(
    message: string,
    opts: {
      cause: unknown;
      exitCode: number | null;
      stderrTail: readonly string[];
      startTimeSeconds: number | undefined;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "FfmpegExitError";
    this.exitCode = opts.exitCode;
    this.stderrTail = opts.stderrTail;
    this.startTimeSeconds = opts.startTimeSeconds;
  }
}

/** Parse an "ffmpeg exited with code N" message; null when the shape doesn't match. */
export function parseFfmpegExitCode(message: string): number | null {
  const match = /exited with code (\d+)/u.exec(message);
  const code = match?.[1];
  return code === undefined ? null : Number(code);
}

function quoteCommandArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:=+?,@%-]+$/u.test(argument)) return argument;
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/**
 * Header values ffmpeg is given verbatim but that must never reach a log.
 *
 * yt-dlp hands back whatever a site needs to serve a signed URL, which for some extractors is a
 * `Cookie` or `Authorization`. Those are credentials: the argument vector is logged in full by the
 * observer, so rendering them here would persist a session token to production logs and to CI
 * artifacts. The value is redacted for display only — `spawn` still receives the real one.
 */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

/** Redact credential-bearing values inside an ffmpeg `-headers` argument, keeping its shape. */
export function redactHeaderArgument(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return line;
      const name = line.slice(0, separator).trim().toLowerCase();
      return SENSITIVE_HEADER_NAMES.has(name)
        ? `${line.slice(0, separator + 1)} <redacted>`
        : line;
    })
    .join("\r\n");
}

function ffmpegCommandLine(
  executable: string,
  args: readonly string[],
): string {
  // `-headers` takes its value as the NEXT argument, so redaction keys off the preceding flag
  // rather than trying to recognise a credential by shape.
  const rendered = args.map((arg, index) =>
    args[index - 1] === "-headers" ? redactHeaderArgument(arg) : arg,
  );
  return [executable, ...rendered].map(quoteCommandArgument).join(" ");
}

function createFfmpegStderrHandler(
  observer: StreamObserver | undefined,
  stderrTail: string[],
): (line: string) => void {
  const codecData: FfmpegCodecData = {};
  const progress: FfmpegProgress = {};
  let codecDataEmitted = false;

  const emitCodecData = () => {
    if (codecDataEmitted || observer?.onCodecData === undefined) return;
    if (
      codecData.format === undefined &&
      codecData.duration === undefined &&
      codecData.video === undefined &&
      codecData.audio === undefined
    ) {
      return;
    }
    codecDataEmitted = true;
    observer.onCodecData({ ...codecData });
  };

  return (line: string) => {
    stderrTail.push(line);
    if (stderrTail.length > 50) stderrTail.shift();

    const inputMatch = /^\s*Input #0,\s*([^,]+(?:,[^,]+)*),\s*from /u.exec(
      line,
    );
    if (inputMatch?.[1] !== undefined) codecData.format = inputMatch[1].trim();

    const durationMatch = /^\s*Duration:\s*([^,]+)/u.exec(line);
    if (durationMatch?.[1] !== undefined) {
      codecData.duration = durationMatch[1].trim();
    }

    const videoMatch = /^\s*Stream #\S+.*Video:\s*([^,]+)(?:,\s*(.*))?/u.exec(
      line,
    );
    if (videoMatch?.[1] !== undefined && codecData.video === undefined) {
      codecData.video = videoMatch[1].trim();
      const details = videoMatch[2]?.trim();
      if (details !== undefined && details.length > 0) {
        codecData.video_details = [details];
      }
    }

    const audioMatch = /^\s*Stream #\S+.*Audio:\s*([^,]+)(?:,\s*(.*))?/u.exec(
      line,
    );
    if (audioMatch?.[1] !== undefined && codecData.audio === undefined) {
      codecData.audio = audioMatch[1].trim();
      const details = audioMatch[2]?.trim();
      if (details !== undefined && details.length > 0) {
        codecData.audio_details = [details];
      }
    }

    const separator = line.indexOf("=");
    if (separator <= 0) return;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "frame") progress.frames = Number(value);
    else if (key === "fps") progress.currentFps = Number(value);
    else if (key === "bitrate") progress.currentKbps = Number.parseFloat(value);
    else if (key === "total_size") {
      const bytes = Number(value);
      if (Number.isFinite(bytes)) progress.targetSize = bytes / 1024;
    } else if (key === "out_time") progress.timemark = value;
    else if (key === "progress") {
      emitCodecData();
      observer?.onProgress?.({ ...progress });
    }
  };
}

/**
 * Render a linear gain for ffmpeg's `volume` filter.
 *
 * Unity renders as the literal `1.0` this filter has always carried, so a caller that leaves
 * `audioVolume` alone gets a byte-identical command line to the one before the option existed —
 * the rawvideo bots (`discord-plays-pokemon`, `discord-plays-mario-kart`) pin that vector. Every
 * other value renders as itself, and `0` stays `0`: silence is a volume, not a missing option, so
 * it must never be rounded or promoted back to unity. ffmpeg parses `1` and `1.0` identically; the
 * spelling is preserved for the diff, not for the filter.
 */
function formatAudioGain(gain: number): string {
  return gain === 1 ? "1.0" : String(gain);
}

export function prepareStream(
  input: string | Readable,
  options: Partial<PrepareStreamOptions> = {},
  cancelSignal?: AbortSignal,
) {
  cancelSignal?.throwIfAborted();
  const defaultOptions = {
    noTranscoding: false,
    // negative values = resize by aspect ratio, see https://trac.ffmpeg.org/wiki/Scaling
    width: -2,
    height: -2,
    videoCodec: "H264",
    bitrateVideo: 5000,
    bitrateVideoMax: 7000,
    bitrateAudio: 128,
    includeAudio: true,
    audioOnly: false,
    audioVolume: 1,
    encoder: Encoders.software(),
    hardwareAcceleratedDecoding: false,
    hardwarePipelineMode: "full",
    minimizeLatency: false,
    lowLatencyMux: false,
    lowDelayAudio: false,
    customHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
      Connection: "keep-alive",
    },
    customInputOptions: [],
    customFfmpegFlags: [],
    inputColor: "sdr",
  } satisfies PrepareStreamOptions;

  function mergeOptions(
    opts: Partial<PrepareStreamOptions>,
  ): PrepareStreamOptions {
    const frameRate =
      isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
        ? opts.frameRate
        : undefined;
    const startTime =
      isFiniteNonZero(opts.startTime) && opts.startTime > 0
        ? opts.startTime
        : undefined;
    const readrate =
      isFiniteNonZero(opts.readrate) && opts.readrate > 0
        ? opts.readrate
        : undefined;
    const readrateInitialBurst =
      isFiniteNonZero(opts.readrateInitialBurst) &&
      opts.readrateInitialBurst > 0
        ? opts.readrateInitialBurst
        : undefined;

    return {
      noTranscoding: opts.noTranscoding ?? defaultOptions.noTranscoding,

      width: isFiniteNonZero(opts.width)
        ? Math.round(opts.width)
        : defaultOptions.width,

      height: isFiniteNonZero(opts.height)
        ? Math.round(opts.height)
        : defaultOptions.height,

      ...(frameRate !== undefined ? { frameRate } : {}),

      ...(readrate !== undefined ? { readrate } : {}),

      ...(readrateInitialBurst !== undefined ? { readrateInitialBurst } : {}),

      videoCodec: opts.videoCodec ?? defaultOptions.videoCodec,

      bitrateVideo:
        isFiniteNonZero(opts.bitrateVideo) && opts.bitrateVideo > 0
          ? Math.round(opts.bitrateVideo)
          : defaultOptions.bitrateVideo,

      bitrateVideoMax:
        isFiniteNonZero(opts.bitrateVideoMax) && opts.bitrateVideoMax > 0
          ? Math.round(opts.bitrateVideoMax)
          : defaultOptions.bitrateVideoMax,

      bitrateAudio:
        isFiniteNonZero(opts.bitrateAudio) && opts.bitrateAudio > 0
          ? Math.round(opts.bitrateAudio)
          : defaultOptions.bitrateAudio,

      encoder: opts.encoder ?? defaultOptions.encoder,

      includeAudio: opts.includeAudio ?? defaultOptions.includeAudio,

      audioOnly: opts.audioOnly ?? defaultOptions.audioOnly,

      // 0 is a meaningful volume (silence), so this cannot use the isFiniteNonZero guard the other
      // numeric options use — it would silently promote a requested mute back to unity gain.
      audioVolume:
        typeof opts.audioVolume === "number" &&
        Number.isFinite(opts.audioVolume) &&
        opts.audioVolume >= 0
          ? opts.audioVolume
          : defaultOptions.audioVolume,

      hardwareAcceleratedDecoding:
        opts.hardwareAcceleratedDecoding ??
        defaultOptions.hardwareAcceleratedDecoding,

      hardwarePipelineMode:
        opts.hardwarePipelineMode ?? defaultOptions.hardwarePipelineMode,

      minimizeLatency: opts.minimizeLatency ?? defaultOptions.minimizeLatency,

      lowLatencyMux: opts.lowLatencyMux ?? defaultOptions.lowLatencyMux,

      lowDelayAudio: opts.lowDelayAudio ?? defaultOptions.lowDelayAudio,

      customHeaders: {
        ...defaultOptions.customHeaders,
        ...opts.customHeaders,
      },
      customInputOptions:
        opts.customInputOptions ?? defaultOptions.customInputOptions,
      customFfmpegFlags:
        opts.customFfmpegFlags ?? defaultOptions.customFfmpegFlags,
      inputColor: opts.inputColor ?? defaultOptions.inputColor,
      ...(opts.subtitleBurn !== undefined
        ? { subtitleBurn: opts.subtitleBurn }
        : {}),
      ...(startTime !== undefined ? { startTime } : {}),
      ...(opts.observer !== undefined ? { observer: opts.observer } : {}),
      ...(opts.pad !== undefined ? { pad: opts.pad } : {}),
      ...(opts.audioInput !== undefined ? { audioInput: opts.audioInput } : {}),
      ...(opts.ffmpegPath !== undefined ? { ffmpegPath: opts.ffmpegPath } : {}),
    } satisfies PrepareStreamOptions;
  }

  const mergedOptions = mergeOptions(options);

  // `audioOnly` does not modify the video path, it deletes it. Anything that is only meaningful in
  // terms of a video stream is therefore a contradiction rather than a setting to quietly ignore —
  // same reasoning as the `noTranscoding` + `subtitleBurn` guard further down, and same failure
  // mode if it were skipped: a stream that looks fine and is missing exactly what was asked for.
  // Checked before the process is built so the caller gets the error instead of an ffmpeg exit.
  if (mergedOptions.audioOnly) {
    if (mergedOptions.subtitleBurn !== undefined) {
      throw new Error(
        "subtitleBurn cannot be applied when audioOnly is set: an audio-only stream has no video frames to burn subtitles onto. Disable audioOnly to burn in subtitles.",
      );
    }
    if (mergedOptions.noTranscoding) {
      throw new Error(
        "noTranscoding cannot be combined with audioOnly: noTranscoding copies the input video stream through unmodified, which is the stream audioOnly removes.",
      );
    }
    if (!mergedOptions.includeAudio) {
      throw new Error(
        "audioOnly requires includeAudio: dropping both the video and the audio stream would produce an output with no streams at all.",
      );
    }
    if (mergedOptions.pad !== undefined) {
      throw new Error(
        "pad cannot be applied when audioOnly is set: letterboxing needs a frame to center on a canvas, and an audio-only stream has none. Drop pad for audio-only output.",
      );
    }
    if (mergedOptions.inputColor === "hdr") {
      // Note the asymmetry with the `noTranscoding` path below, which only warns here: there, the
      // caller opted out of transcoding and the video keeps its original transfer, so the request
      // is merely redundant. On an audio-only stream there is no picture whose colour a tonemap
      // could describe, so the request is void rather than redundant.
      throw new Error(
        "inputColor 'hdr' cannot be applied when audioOnly is set: there is no video stream to tonemap. Drop inputColor for audio-only output.",
      );
    }
  }

  let isHttpUrl = false;
  let isHls = false;
  let isSrt = false;

  if (typeof input === "string") {
    isHttpUrl = input.startsWith("http") || input.startsWith("https");
    isHls = input.includes("m3u");
    isSrt = input.startsWith("srt://");
  }

  const output = new PassThrough();

  const commandBuilder = new FfmpegArgumentBuilder(input);
  const { observer } = options;

  // input seek: `-ss` before `-i` is a fast, accurate input seek for seekable sources.
  if (mergedOptions.startTime !== undefined) {
    commandBuilder.inputOption("-ss", String(mergedOptions.startTime));
  }

  // Cap input demux rate as a multiple of realtime to prevent the encoder from running ahead of
  // the downstream send loop. Producer overrun is the dominant cause of unbounded NUT-side buffer
  // accumulation in the consumer process. Skip for live inputs (HTTP HLS, SRT, raw audio input)
  // where ffmpeg's own docs warn `-readrate` can cause packet loss.
  if (mergedOptions.readrate !== undefined && !isHls && !isSrt) {
    commandBuilder.inputOption("-readrate", String(mergedOptions.readrate));
    // Only meaningful alongside readrate: how much input to burst-read before pacing engages.
    // The pre-roll gives the otherwise zero-margin realtime pipeline a cushion (see the option doc).
    if (mergedOptions.readrateInitialBurst !== undefined) {
      commandBuilder.inputOption(
        "-readrate_initial_burst",
        String(mergedOptions.readrateInitialBurst),
      );
    }
  }

  // input options
  if (
    mergedOptions.customInputOptions &&
    mergedOptions.customInputOptions.length > 0
  ) {
    commandBuilder.inputOptions(mergedOptions.customInputOptions);
  }

  const {
    hardwareAcceleratedDecoding,
    minimizeLatency,
    customHeaders,
    audioOnly,
  } = mergedOptions;

  // Resolve the encoder up front so its optional `hwPipeline` can drive both the input decode
  // options and the scale filter below. A hardware encoder that declares `hwPipeline` (e.g. VAAPI)
  // lets us decode straight into GPU surfaces and scale on the GPU, avoiding the software `scale`
  // (swscale) that would otherwise download every frame to system memory.
  //
  // Skipped entirely on the audio-only path. Resolution is what produces the encoder's device-init
  // arguments (`-init_hw_device`/`-vaapi_device …renderD128`) and its `hwPipeline`, so leaving it
  // undefined is what keeps a host with no `/dev/dri` from being asked for a VAAPI device to encode
  // a stream that has no picture. Everything downstream already treats `undefined` as "no hardware
  // pipeline", so no further branch is needed to make `hwPipeline` fall away with it.
  const encoderSettings =
    mergedOptions.noTranscoding || audioOnly
      ? undefined
      : mergedOptions.encoder(
          mergedOptions.bitrateVideo,
          mergedOptions.bitrateVideoMax,
        )[mergedOptions.videoCodec];
  // Only take the GPU pipeline when both dimensions are explicit positives: `scale_vaapi` aborts on
  // the negative aspect-ratio shorthand (`-2`) that the software `scale` accepts, so anything
  // without concrete dimensions falls back to the (correct, if slower) software path.
  const hwPipeline =
    hardwareAcceleratedDecoding &&
    encoderSettings?.hwPipeline &&
    mergedOptions.width > 0 &&
    mergedOptions.height > 0
      ? encoderSettings.hwPipeline
      : undefined;

  const uploadMode =
    hwPipeline !== undefined && mergedOptions.hardwarePipelineMode === "upload";
  if (uploadMode && !hwPipeline.uploadDecodeOptions) {
    throw new Error(
      `hardwarePipelineMode "upload" requested but the ${mergedOptions.videoCodec} encoder's hwPipeline declares no uploadDecodeOptions`,
    );
  }

  // Hardware DECODE options are video decode options. On the audio-only path there is nothing to
  // decode into GPU surfaces, and `-hwaccel auto` (the no-pipeline fallback below) would ask a
  // possibly GPU-less host to initialise an accelerator for a stream that is never demanded.
  if (hardwareAcceleratedDecoding && !audioOnly) {
    if (hwPipeline) {
      commandBuilder.inputOptions(
        uploadMode && hwPipeline.uploadDecodeOptions
          ? hwPipeline.uploadDecodeOptions
          : hwPipeline.decodeOptions,
      );
    } else commandBuilder.inputOption("-hwaccel", "auto");
  }

  const latencyInputOptions = minimizeLatency
    ? ["-fflags", "nobuffer", "-analyzeduration", "0"]
    : [];
  commandBuilder.inputOptions(latencyInputOptions);

  if (isHttpUrl) {
    commandBuilder.inputOption(
      "-headers",
      Object.entries(customHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n"),
    );
    if (!isHls) {
      commandBuilder.inputOptions([
        "-reconnect",
        "1",
        "-reconnect_at_eof",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "4294",
      ]);
    }
  }

  if (isSrt) {
    commandBuilder.inputOption("-scan_all_pmts", "0");
  }

  // Optional second input carrying audio: a raw-video source with no embedded audio track, or a
  // split yt-dlp result whose video and audio are separately signed URLs. Added after every
  // input-0 option above so its inputOptions bind to this input. Mapped via `-map 1:a:0` below.
  // Only wired when audio output is enabled.
  if (mergedOptions.audioInput && mergedOptions.includeAudio) {
    commandBuilder.input(mergedOptions.audioInput.source).inputOptions([
      // `-ss` is an input option: it seeks the input it precedes, and nothing else. Applying it
      // to input 0 alone would start the picture at the requested offset while its soundtrack
      // restarted from zero — so every resume, crash retry and live seek would play the right
      // video against the wrong audio, and the audio would outlast the video by the offset.
      ...(mergedOptions.startTime === undefined
        ? []
        : ["-ss", String(mergedOptions.startTime)]),
      ...latencyInputOptions,
      ...mergedOptions.audioInput.inputOptions,
    ]);
  }

  // general output options
  commandBuilder.output(output).outputFormat("nut");

  // video setup (the `encoder` is resolved earlier, into `encoderSettings`/`hwPipeline`)
  const {
    noTranscoding,
    width,
    height,
    frameRate,
    bitrateVideo,
    bitrateVideoMax,
    videoCodec,
  } = mergedOptions;

  if (audioOnly) {
    // One guard replaces the entire video output stage: no `-map 0:v`, no `-c:v`/`-b:v`/`-bf 0`/
    // `-force_key_frames`/`-pix_fmt`/`-r`, and no `-filter:v` or `-filter_complex` chain. `-vn`
    // then makes the intent explicit to ffmpeg rather than relying on the absence of a mapping:
    // with no `-map` for video and no `-vn`, ffmpeg's default stream selection would pick the
    // input's best video stream back up and try to encode it.
    commandBuilder.addOutputOption("-vn");
  } else if (noTranscoding) {
    // `noTranscoding` passes the input video through unmodified, so a filter graph can't apply.
    // Fail fast instead of silently dropping a requested subtitle burn; an HDR input merely keeps
    // its original transfer (the caller opted out of transcoding), so warn rather than throw.
    if (mergedOptions.subtitleBurn !== undefined) {
      throw new Error(
        "subtitleBurn cannot be applied when noTranscoding is set: the input video stream is copied through unmodified. Disable noTranscoding to burn in subtitles.",
      );
    }
    if (mergedOptions.inputColor === "hdr") {
      new Log("prepareStream").warn(
        "inputColor 'hdr' is ignored when noTranscoding is set: the video stream is copied through unmodified, so no tonemap can apply",
      );
    }
    commandBuilder.addOutputOption(["-map", "0:v"]);
    commandBuilder.videoCodec("copy");
  } else {
    if (!encoderSettings)
      throw new Error(`Encoder settings not specified for ${videoCodec}`);

    // Build the whole video graph with the pure builders in videoGraph.ts (unit-testable without
    // spawning ffmpeg): scale (GPU when the encoder declares a hardware pipeline, else software
    // `scale`), HDR tonemap, subtitle burn, and — software path only — the encoder's own output
    // filters (on a GPU pipeline the frames are already hardware surfaces, so upload/format
    // outFilters are unnecessary).
    //
    // On the software path an optional `pad` letterboxes/pillarboxes the scaled frame onto a
    // centered black canvas (e.g. fit 4:3 content into a 16:9 output). `pad` is intentionally not
    // supported on the GPU pipeline.
    const { pad } = mergedOptions;
    const padded = pad !== undefined && pad.width > 0 && pad.height > 0;
    if (padded && hwPipeline) {
      // The GPU pipeline scales with scale_vaapi and never consults `pad`; make
      // the silent drop visible rather than emitting unexpectedly-unletterboxed output.
      new Log("prepareStream").warn(
        "`pad` (letterbox) is ignored when a hardware decode pipeline is active (scale_vaapi); " +
          "use the software path (hardwareAcceleratedDecoding: false) for padded output",
      );
    }
    const graphSpec = {
      width,
      height,
      inputColor: mergedOptions.inputColor,
      ...(uploadMode ? { uploadInput: true } : {}),
      ...(frameRate !== undefined ? { frameRate } : {}),
      ...(mergedOptions.subtitleBurn !== undefined
        ? {
            subtitle: {
              path: mergedOptions.subtitleBurn.path,
              startTime: mergedOptions.startTime ?? 0,
            },
          }
        : {}),
    };
    const graph = hwPipeline
      ? hwPipeline.videoGraph(graphSpec)
      : buildSoftwareVideoGraph({
          ...graphSpec,
          ...(padded ? { pad } : {}),
          encoderOutFilters: encoderSettings.outFilters ?? [],
        });
    if (graph.kind === "filterChain") {
      commandBuilder.addOutputOption(["-map", "0:v"]);
      commandBuilder.videoFilter(graph.filters);
    } else {
      // Multi-branch graph (GPU subtitle overlay): -filter_complex plus -map of its labeled
      // output. `-map 0:v` must NOT be emitted alongside it — that would put a second, unfiltered
      // video stream into the NUT output.
      commandBuilder.complexFilter(graph.graph, graph.mapLabel);
    }

    if (frameRate) commandBuilder.fpsOutput(frameRate);

    commandBuilder.addOutputOption([
      "-b:v",
      `${bitrateVideo}k`,
      "-maxrate:v",
      `${bitrateVideoMax}k`,
      "-bufsize:v",
      `${Math.round(bitrateVideo / 2)}k`,
      "-bf",
      "0",
      // `-pix_fmt yuv420p` only applies to the software path. On a GPU pipeline the surface format
      // is set by the scale filter (`format=nv12`) and h264_vaapi auto-selects `vaapi` anyway.
      ...(hwPipeline ? [] : ["-pix_fmt", "yuv420p"]),
      "-force_key_frames",
      "expr:gte(t,n_forced*1)",
    ]);

    commandBuilder
      .videoCodec(encoderSettings.name)
      .outputOptionsList(encoderSettings.options)
      // `globalOptions` serve the software-decode path (device init for the outFilters hwupload).
      // When the hardware pipeline is active its decodeOptions already initialized the same named
      // device, and a second -init_hw_device with that name is a hard ffmpeg error.
      .outputOptionsList(
        hwPipeline ? [] : (encoderSettings.globalOptions ?? []),
      );
  }

  // Per-packet muxer flush for realtime consumers (see PrepareStreamOptions.lowLatencyMux).
  if (mergedOptions.lowLatencyMux)
    commandBuilder.addOutputOption(["-flush_packets", "1"]);

  // audio setup
  const { includeAudio, bitrateAudio, audioInput, audioVolume } = mergedOptions;
  if (includeAudio) {
    // With a separate audio input, map its first audio stream (a required mapping — the caller
    // promised a stream); otherwise take audio from the primary input if it has any (`?`).
    //
    // The `?` comes off on the audio-only path: audio is then the only output stream, so a source
    // without one yields a NUT containing nothing, and a realtime consumer waits on it forever.
    // Required mapping turns that into an immediate, classifiable ffmpeg startup failure
    // ("Stream map '' matches no streams") instead of a silent hang.
    const audioMap = audioInput ? "1:a:0" : audioOnly ? "0:a:0" : "0:a:0?";
    commandBuilder
      .addOutputOption(["-map", audioMap])
      .audioChannels(2)
      /*
       * I don't have much surround sound material to test this with,
       * if you do and you have better settings for this, feel free to
       * contribute!
       */
      .addOutputOption(["-lfe_mix_level", "1"])
      .audioFrequency(48000)
      .audioCodec("libopus")
      .audioBitrate(`${bitrateAudio}k`)
      .audioFilters(`volume@internal_lib=${formatAudioGain(audioVolume)}`);
    // Realtime Opus tuning (see PrepareStreamOptions.lowDelayAudio). libopus private options —
    // they bind to the (only) audio stream, after -c:a above.
    if (mergedOptions.lowDelayAudio)
      commandBuilder.addOutputOption([
        "-application",
        "lowdelay",
        "-frame_duration",
        "10",
      ]);
  }

  // Add custom ffmpeg flags
  if (
    mergedOptions.customFfmpegFlags &&
    mergedOptions.customFfmpegFlags.length > 0
  ) {
    commandBuilder.addOptions(mergedOptions.customFfmpegFlags);
  }

  // realtime control mechanism
  let currentVolume = 1;
  let zmqClientPromise: Promise<Request> | undefined;
  let zmqEndpoint: string | undefined;
  if (includeAudio && !isBun() && !isDeno()) {
    function randomInclusive(start: number, end: number) {
      return Math.floor(Math.random() * (end - start + 1)) + start;
    }
    // Last octet is from 2 to 254 to avoid WSL2 shenanigans
    const loopbackIp = [
      127,
      randomInclusive(0, 255),
      randomInclusive(0, 255),
      randomInclusive(2, 254),
    ].join(".");
    zmqEndpoint = `tcp://${loopbackIp}:42069`;
    commandBuilder.audioFilters(
      `azmq=b=${zmqEndpoint.replaceAll(":", "\\\\:")}`,
    );
  }

  const args = commandBuilder.arguments();
  const executable =
    mergedOptions.ffmpegPath ?? process.env["FFMPEG_PATH"] ?? "ffmpeg";
  const child = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const command = new FfmpegProcessHandle(args, child);
  observer?.onCommand?.(ffmpegCommandLine(executable, args));
  if (command.pid !== undefined) observer?.onProcessStart?.(command.pid);

  const primaryInput = commandBuilder.inputs[0]?.source;
  if (typeof primaryInput === "string" || primaryInput === undefined) {
    child.stdin.end();
  } else {
    primaryInput.pipe(child.stdin);
  }
  child.stdout.pipe(output);

  const stderrTail: string[] = [];
  const stderrLines = createInterface({ input: child.stderr });
  const handleStderr = createFfmpegStderrHandler(observer, stderrTail);
  stderrLines.on("line", handleStderr);

  let spawnError: Error | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      spawnError = error;
      if (cancelSignal?.aborted) reject(cancelSignal.reason);
      else {
        reject(
          new FfmpegExitError(error.message, {
            cause: error,
            exitCode: null,
            stderrTail: [...stderrTail],
            startTimeSeconds: mergedOptions.startTime,
          }),
        );
      }
    });
    child.once("close", (code, signal) => {
      if (cancelSignal?.aborted) {
        reject(cancelSignal.reason);
        return;
      }
      if (spawnError !== undefined) return;
      if (code === 0) {
        resolve();
        return;
      }
      const message =
        code === null
          ? `ffmpeg exited from signal ${signal ?? "unknown"}`
          : `ffmpeg exited with code ${code.toString()}`;
      const cause = new Error(message);
      reject(
        new FfmpegExitError(message, {
          cause,
          exitCode: code,
          stderrTail: [...stderrTail],
          startTimeSeconds: mergedOptions.startTime,
        }),
      );
    });
  });
  promise.catch(() => {});
  cancelSignal?.addEventListener("abort", () => command.kill("SIGTERM"), {
    once: true,
  });

  if (zmqEndpoint !== undefined) {
    const endpoint = zmqEndpoint;
    zmqClientPromise = import("zeromq").then((zmq) => {
      const client = new zmq.Request({
        sendTimeout: 5000,
        receiveTimeout: 5000,
      });
      client.connect(endpoint);
      promise.catch(() => {}).finally(() => client.disconnect(endpoint));
      return client;
    });
  }

  return {
    command,
    output,
    promise,
    controller: {
      get volume() {
        return currentVolume;
      },
      async setVolume(newVolume: number) {
        if (newVolume < 0) return false;
        try {
          if (!zmqClientPromise) return false;
          const client = await zmqClientPromise;
          await client.send(`volume@internal_lib volume ${newVolume}`);
          const [res] = await client.receive();
          if (res === undefined) return false;
          if (res.toString("utf-8").split(" ")[0] !== "0") return false;
          currentVolume = newVolume;
          return true;
        } catch {
          return false;
        }
      },
    } satisfies Controller,
  };
}

export type PlayStreamOptions = {
  /**
   * Where this media is sent.
   *
   * - `"go-live"` — its own Go-Live (screen share) connection, created and torn down per stream.
   * - `"camera"` — video on the normal voice connection, announced as the camera.
   * - `"voice"` — audio only on the normal voice connection, with plain microphone semantics: no
   *   video is signalled and none is sent.
   *
   * **`"voice"` deliberately touches nothing on the connection.** Not `setPacketizer`, not
   * `setVideoAttributes`, not `signalVideo`, not `setSpeaking`, not `createStream`/`stopStream`.
   * That is load-bearing and not obvious:
   *
   * - The normal voice connection is a **shared** resource. A consumer can be speaking over it
   *   from another source at the same time (streambot mixes a voice assistant into the same RTP
   *   stream), so the speaking flag is arbitrated by whoever owns the connection. A segment that
   *   cleared it when its own track ended would silence that other source mid-sentence.
   * - `setPacketizer` is worse than redundant here: it builds a fresh `_audioPacketizer` but leaves
   *   the `_audioMediaHandler` already bound to the track in place (only `setAudioPacketizer`
   *   keeps those two consistent), so audio would keep flowing through a handler wrapping the
   *   previous packetizer — and where that handler is the `RtcpReceivingSession` installed for
   *   receive, inbound audio would break with it.
   *
   * The connection is configured once by whoever joined voice; a `"voice"` segment only borrows it.
   */
  type: "go-live" | "camera" | "voice";

  /**
   * Set format of the stream
   */
  format: "matroska" | "nut";

  /**
   * Override video width sent to Discord.
   *
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  width: number | ((v: VideoStreamInfo) => number);

  /**
   * Override video height sent to Discord.
   *
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  height: number | ((v: VideoStreamInfo) => number);

  /**
   * Override video frame rate sent to Discord.
   *
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  frameRate: number | ((v: VideoStreamInfo) => number);

  /**
   * Same as ffmpeg's `readrate_initial_burst` command line flag
   *
   * See https://ffmpeg.org/ffmpeg.html#:~:text=%2Dreadrate_initial_burst
   */
  readrateInitialBurst: number | undefined;

  /**
   * Enable stream preview from input stream (experimental)
   */
  streamPreview: boolean;

  /**
   * Upper bound, in milliseconds, advertised to receivers through the
   * `playout-delay` RTP header extension. Receivers pick their jitter-buffer
   * target within [0, max]; on a clean link Chrome sits at the ceiling, so this
   * effectively sets the client-side delay floor for an interactive stream.
   *
   * Defaults to 100ms (the long-standing value) so existing consumers keep
   * their current behavior. Lower it only for genuinely low-jitter links —
   * a real-time game stream on a good network — because the headroom you
   * remove is what otherwise absorbs jitter without a visible freeze.
   */
  videoPlayoutDelayMaxMs: number | undefined;

  /**
   * Optional observability seam. When supplied, per-frame send timing (frametime ratio) from the
   * video/audio send path is forwarded to the observer. No effect on behavior.
   */
  observer?: StreamObserver;

  /**
   * Where the paced Opus frames go. Defaults to the connection this stream is attached to, which
   * is the behavior every existing caller has.
   *
   * Supplying a sink puts a consumer-owned stage between the pacer and the transport — the place to
   * apply gain, or to mix a second source into the same RTP stream so both share one packetizer and
   * one timestamp sequence. A sink is expected to forward to the connection itself; see
   * {@link ./AudioSink.js AudioFrameSink} for why its return value must report a dropped frame.
   */
  audioSink?: AudioFrameSink;
};

const playStreamDefaultOptions = {
  type: "go-live",
  format: "nut",
  width: (video) => video.width,
  height: (video) => video.height,
  frameRate: (video) => video.framerate_num / video.framerate_den,
  readrateInitialBurst: undefined,
  streamPreview: false,
  videoPlayoutDelayMaxMs: undefined,
} satisfies PlayStreamOptions;

/**
 * Merge user-supplied {@link PlayStreamOptions} with defaults. Exported so both {@link playStream}
 * and the seekable player ({@link ./player.ts}) share one source of truth for option resolution.
 */
export function mergePlayStreamOptions(
  opts: Partial<PlayStreamOptions>,
): PlayStreamOptions {
  return {
    type: opts.type ?? playStreamDefaultOptions.type,

    format: opts.format ?? playStreamDefaultOptions.format,

    width:
      typeof opts.width === "function" ||
      (isFiniteNonZero(opts.width) && opts.width > 0)
        ? opts.width
        : playStreamDefaultOptions.width,

    height:
      typeof opts.height === "function" ||
      (isFiniteNonZero(opts.height) && opts.height > 0)
        ? opts.height
        : playStreamDefaultOptions.height,

    frameRate:
      typeof opts.frameRate === "function" ||
      (isFiniteNonZero(opts.frameRate) && opts.frameRate > 0)
        ? opts.frameRate
        : playStreamDefaultOptions.frameRate,

    readrateInitialBurst:
      isFiniteNonZero(opts.readrateInitialBurst) &&
      opts.readrateInitialBurst > 0
        ? opts.readrateInitialBurst
        : playStreamDefaultOptions.readrateInitialBurst,

    streamPreview: opts.streamPreview ?? playStreamDefaultOptions.streamPreview,

    // 0 is meaningful here (ask the receiver not to buffer at all), so this
    // cannot use the isFiniteNonZero guard the other numeric options use.
    videoPlayoutDelayMaxMs:
      typeof opts.videoPlayoutDelayMaxMs === "number" &&
      Number.isFinite(opts.videoPlayoutDelayMaxMs)
        ? opts.videoPlayoutDelayMaxMs
        : playStreamDefaultOptions.videoPlayoutDelayMaxMs,

    ...(opts.observer !== undefined ? { observer: opts.observer } : {}),

    ...(opts.audioSink !== undefined ? { audioSink: opts.audioSink } : {}),
  } satisfies PlayStreamOptions;
}

export type AttachPipelineOptions = PlayStreamOptions & {
  /**
   * Configure the connection's packetizer, speaking state, and video attributes. `true` for a fresh
   * stream; `false` when re-attaching a new source onto an already-streaming connection (seek), so
   * the existing RTP packetizer — and therefore RTP timestamp continuity — is preserved.
   */
  configureConn: boolean;
};

export type AttachedPipeline = {
  /** Resolves when this source plays to its natural end; rejects if `cancelSignal` aborts. */
  done: Promise<void>;
  /** Tear down this segment's demuxer/streams/preview WITHOUT touching the connection. */
  destroy: () => void;
};

/**
 * Demux `input`, wire it to fresh {@link VideoStream}/{@link AudioStream} bound to `conn`, and
 * (optionally) configure the connection. Returns a handle whose `done` promise tracks this single
 * source's playback. The connection itself is owned by the caller — this never tears it down — so a
 * seekable player can re-attach a new source onto the same Go-Live connection. Extracted from
 * {@link playStream} so both share the demux→stream→pipe→preview logic verbatim.
 */
export async function attachPipeline(
  conn: WebRtcConnWrapper,
  streamer: Streamer,
  input: Readable,
  options: AttachPipelineOptions,
  cancelSignal?: AbortSignal,
): Promise<AttachedPipeline> {
  const logger = new Log("attachPipeline");
  cancelSignal?.throwIfAborted();

  logger.debug("Initializing demuxer");
  const { video, audio } = await demux(input, {
    format: options.format,
    ...(options.observer === undefined ? {} : { observer: options.observer }),
  });
  cancelSignal?.throwIfAborted();

  // Which stream this pipeline requires is a function of where it is going, not of the pipeline.
  // A Go-Live or camera segment IS a video stream, so a source with no video track is a broken
  // contract there — and the message stays exactly what it has always been, because callers match
  // on it (streambot's hardware→software retry ladder among them). `type: "voice"` carries audio
  // over the normal voice connection, where video has no meaning and its absence is the norm.
  if (options.type === "voice") {
    if (!audio) throw new Error("No audio stream in media");
    if (video) {
      // A voice segment carries audio and nothing else, so a source that still has a video track
      // was built wrong — `prepareStream({ audioOnly: true })` emits `-vn` and cannot produce one.
      //
      // Rejecting it is the only safe response, and the alternatives are worse than they look:
      //   - Wiring the video up anyway (what this did before) makes it the sync master and the
      //     stream whose `finish` settles `done`, pacing an audio-only transport off a video clock
      //     and sending frames at a connection with no video packetizer. Inert, until it isn't.
      //   - Building no VideoStream and simply leaving the track alone DEADLOCKS the segment.
      //     LibavDemuxer drives one read loop for both tracks and stops it on `!vPipe.write(...)`,
      //     resuming only on that pipe's `drain` — so an unconsumed video pipe silently halts the
      //     AUDIO too, a few seconds in, with no error anywhere.
      //   - Draining the track to discard it would work, but each packet is a cloned libav Packet
      //     that must be `free()`d, so it means paying full demux cost plus a hand-rolled free loop
      //     to throw the result away — and hiding the caller's mistake while doing it.
      throw new Error(
        'Video stream in media for a "voice" play type: this transport carries audio only. Use prepareStream({ audioOnly: true }) to produce the source, or play this media with type "go-live" or "camera".',
      );
    }
  } else if (!video) {
    throw new Error("No video stream in media");
  }

  const cleanupFuncs: (() => unknown)[] = [];
  const videoCodecMap: Record<number, SupportedVideoCodec> = {
    [AVCodecID.AV_CODEC_ID_H264]: "H264",
    [AVCodecID.AV_CODEC_ID_H265]: "H265",
    [AVCodecID.AV_CODEC_ID_VP8]: "VP8",
    [AVCodecID.AV_CODEC_ID_VP9]: "VP9",
    [AVCodecID.AV_CODEC_ID_AV1]: "AV1",
  };

  // Skipped wholesale for `type: "voice"`, which owns nothing on the shared voice connection — see
  // the ownership note on {@link PlayStreamOptions.type}. Neither guard can silently skip real
  // work: the checks above threw if a non-voice source had no video, and if a voice source had one.
  // Both are kept anyway — the type check states the ownership rule at the site it protects, and
  // the `video` check is what narrows the type here.
  if (options.configureConn && options.type !== "voice" && video) {
    const videoCodec = videoCodecMap[video.codec];
    if (videoCodec === undefined)
      throw new Error(`Unsupported video codec ID: ${String(video.codec)}`);
    conn.setPacketizer(videoCodec, options.videoPlayoutDelayMaxMs);
    conn.mediaConnection.setSpeaking(true);
    const { width, height, frameRate } = options;
    conn.mediaConnection.setVideoAttributes(true, {
      width: Math.round(typeof width === "function" ? width(video) : width),
      height: Math.round(typeof height === "function" ? height(video) : height),
      fps: Math.round(
        typeof frameRate === "function" ? frameRate(video) : frameRate,
      ),
    });
  }

  // Hoisted and conditional: an audio-only segment builds no video stream at all, and everything
  // downstream that used to assume one (sync master, queue depth, preview, teardown, and the
  // `finish` that settles `done`) branches on it below.
  let vStream: VideoStream | undefined;
  if (video) {
    vStream = new VideoStream(conn, false, options.observer);
    video.stream.pipe(vStream);
  }
  if (options.observer?.onQueueDepth) {
    // Periodic demux→pacer queue depths (objectMode lengths = buffered packet counts). Empty
    // queues during a production dip mean the producer starved; full queues mean the pacer is the
    // backpressure source — the distinction that required in-pod thread sampling to establish
    // during the 2026-07-18 stutter investigation.
    // The demux streams are typed Readable but are concretely PassThrough; the writable-side
    // buffer (hwm 128) holds most of the queued packets, so include it when available.
    const bufferedPackets = (s: Readable): number =>
      s.readableLength + (s instanceof PassThrough ? s.writableLength : 0);
    const queueDepthTimer = setInterval(() => {
      options.observer?.onQueueDepth?.({
        // Both halves are reported as 0 when the corresponding stream is absent, keeping the
        // observation shape stable across segment kinds.
        video: video ? bufferedPackets(video.stream) : 0,
        audio: audio ? bufferedPackets(audio.stream) : 0,
      });
    }, 5000);
    queueDepthTimer.unref();
    cleanupFuncs.push(() => clearInterval(queueDepthTimer));
  }
  // Hoisted so destroy() can tear the audio side down too (see the destroy closure below).
  let aStream: AudioStream | undefined;
  if (audio) {
    // `audioSink` defaults to the connection, so the ordinary path is byte-for-byte the previous
    // one; a consumer that supplies a sink owns the last hop instead (gain, mixing).
    const a = new AudioStream(
      options.audioSink ?? conn,
      false,
      options.observer,
    );
    aStream = a;
    audio.stream.pipe(a);
    if (vStream) vStream.syncStream = a;

    const burstTime = options.readrateInitialBurst;
    if (typeof burstTime === "number") {
      // The burst gate hangs off whichever stream is the pipeline's clock: the video stream when
      // there is one (audio is slaved to it through `syncStream` above), otherwise the audio stream,
      // which is the only clock an audio-only pipeline has. Keying it on video regardless would
      // leave an audio-only segment permanently in burst mode — no pacing, the whole track pushed
      // at read speed.
      //
      // Clearing `noSleep` is also what re-anchors the schedule: BaseMediaStream's setter calls
      // `resetTimingCompensation()` on the way to `false`, so `_startTime`/`_startPts` are taken at
      // the moment pacing engages rather than at the start of the burst.
      const clock = vStream ?? a;
      a.noSleep = true;
      if (vStream) {
        vStream.sync = false;
        vStream.noSleep = true;
      }
      const stopBurst = (pts: number) => {
        if (pts < burstTime * 1000) return;
        a.noSleep = false;
        if (vStream) {
          vStream.sync = true;
          vStream.noSleep = false;
        }
        clock.off("pts", stopBurst);
      };
      clock.on("pts", stopBurst);
    }
  }
  if (options.streamPreview && options.type === "go-live" && video) {
    (async () => {
      const previewLogger = new Log("playStream:preview");
      previewLogger.debug("Initializing decoder for stream preview");
      const decoder = await createDecoder(video.avStream);
      if (!decoder) {
        previewLogger.warn(
          "Failed to initialize decoder. Stream preview will be disabled",
        );
        return;
      }
      cleanupFuncs.push(() => {
        previewLogger.debug("Freeing decoder");
        decoder.free();
      });
      const updatePreview = pDebounce.promise(async (packet: Packet) => {
        if (!(packet.flags !== undefined && packet.flags & AV_PKT_FLAG_KEY))
          return;
        const decodeStart = performance.now();
        const frames = await decoder.decode(packet).catch((e) => {
          previewLogger.error(e, "Failed to decode the frame");
          return [];
        });
        if (!frames.length) return;

        const decodeEnd = performance.now();
        previewLogger.debug(
          `Decoding a frame took ${decodeEnd - decodeStart}ms`,
        );
        const frame = frames[0];
        if (frame === undefined) return;

        return sharp(frame.toBuffer(), {
          raw: {
            width: frame.width ?? 0,
            height: frame.height ?? 0,
            channels: 4,
          },
        })
          .resize(1024, 576, { fit: "inside" })
          .jpeg()
          .toBuffer()
          .then((image) => streamer.setStreamPreview(image))
          .catch(() => {})
          .finally(() => {
            frames.forEach((frame) => {
              frame.free();
            });
          });
      });
      video.stream.on("data", updatePreview);
      cleanupFuncs.push(() => video.stream.off("data", updatePreview));
    })();
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const f of cleanupFuncs) f();
  };
  // The stream whose `finish` means "this segment played out": the video stream when there is one
  // (its pacer is the clock and audio is slaved to it), otherwise the audio stream. Keying this on
  // video alone — as it did before audio-only playback existed — would leave an audio-only `done`
  // pending forever: not an error, a silent hang, with the caller reporting healthy playback of a
  // track that finished minutes ago. The throw is unreachable given the require-checks at the top;
  // it is here so that "`done` can always be settled" is an invariant the code states rather than
  // one a future edit can quietly remove.
  const finishStream = vStream ?? aStream;
  if (finishStream === undefined) {
    throw new Error(
      "attachPipeline produced no media stream: the demuxer reported neither video nor audio",
    );
  }

  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = () => {
      cleanup();
      resolve();
    };
    cancelSignal?.addEventListener(
      "abort",
      () => {
        cleanup();
        reject(cancelSignal.reason);
      },
      { once: true },
    );
    finishStream.once("finish", () => {
      if (cancelSignal?.aborted) return;
      cleanup();
      resolve();
    });
    // A demuxer error destroys the source pipes with the error instead of ending them (see
    // LibavDemuxer's cleanup). Pipe does not forward source errors to the destination, so without
    // this listener `done` would never settle — surface it as a real failure.
    const onSourceError = (err: Error) => {
      if (cancelSignal?.aborted) return;
      cleanup();
      reject(err);
    };
    video?.stream.once("error", onSourceError);
    audio?.stream.once("error", onSourceError);
  });

  return {
    done,
    destroy: () => {
      // Force-end this segment (used on seek): drop the source pipes + BOTH streams so the old
      // segment can't keep writing to `conn` while the next one starts (audio desync otherwise). The
      // `finish` handler (or this resolveDone) settles `done`; cleanup is idempotent.
      if (video && vStream) {
        video.stream.unpipe(vStream);
        vStream.destroy();
      }
      if (audio && aStream) {
        audio.stream.unpipe(aStream);
        aStream.destroy();
      }
      resolveDone?.();
    },
  };
}

export async function playStream(
  input: Readable,
  streamer: Streamer,
  options: Partial<PlayStreamOptions> = {},
  cancelSignal?: AbortSignal,
) {
  cancelSignal?.throwIfAborted();
  if (!streamer.voiceConnection)
    throw new Error("Bot is not connected to a voice channel");

  const mergedOptions = mergePlayStreamOptions(options);

  let conn: WebRtcConnWrapper;
  let stopStream: () => unknown;
  if (mergedOptions.type === "go-live") {
    conn = await streamer.createStream();
    stopStream = () => streamer.stopStream();
  } else if (mergedOptions.type === "camera") {
    conn = streamer.voiceConnection.webRtcConn;
    streamer.signalVideo(true);
    stopStream = () => streamer.signalVideo(false);
  } else {
    // "voice": borrow the already-joined voice connection and give it back exactly as found. No
    // signalVideo on the way in, and nothing at all on the way out — see PlayStreamOptions.type.
    conn = streamer.voiceConnection.webRtcConn;
    stopStream = () => undefined;
  }

  const pipeline = await attachPipeline(
    conn,
    streamer,
    input,
    { ...mergedOptions, configureConn: true },
    cancelSignal,
  );
  try {
    await pipeline.done;
  } catch {
    // Aborted via cancelSignal — swallowed to preserve the original playStream behavior (it resolved
    // on both natural finish and abort).
  } finally {
    stopStream();
    if (mergedOptions.type !== "voice") {
      conn.mediaConnection.setSpeaking(false);
      conn.mediaConnection.setVideoAttributes(false);
    }
  }
}
