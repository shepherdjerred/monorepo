import ffmpeg from "fluent-ffmpeg";
import pDebounce from "p-debounce";
import { createRequire as __createRequire } from "node:module";
import Log from "debug-level";

// Lazy-load sharp: it is only used by the optional streamPreview path. Loading it eagerly forces a
// native dlopen that fails on some bun/global-cache layouts. The module name is built at runtime so
// the bundler cannot statically pre-resolve (and therefore eagerly load) it. Previously a committed
// bun patch in the consumer packages; baked into source here.
const __require = __createRequire(import.meta.url);
type SharpFactory = typeof import("sharp");
let __sharpModule: SharpFactory | undefined;
const __sharpName = ["sh", "arp"].join("");
const sharp = ((...args: Parameters<SharpFactory>): ReturnType<SharpFactory> => {
  const factory: SharpFactory = __sharpModule ?? (__sharpModule = __require(__sharpName));
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

import type { Request } from "zeromq";
import type { SupportedVideoCodec } from "../utils.js";
import type { Streamer } from "../client/index.js";
import type { EncoderSettingsGetter } from "./encoders/index.js";
import type { VideoStreamInfo } from "./LibavDemuxer.js";
import type { WebRtcConnWrapper } from "../client/voice/WebRtcWrapper.js";

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
   * Add some options to minimize latency
   */
  minimizeLatency: boolean;

  /**
   * Custom headers for HTTP requests
   */
  customHeaders: Record<string, string>;

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
   * Extra video filters appended to the transcoding filter chain, immediately after the internal
   * `scale` filter and before the encoder's own output filters (e.g.
   * `["subtitles='/tmp/subs.srt'"]` to burn in subtitles). Ignored when `noTranscoding` is set.
   * Composed into the same `-vf` chain as `scale`, so — unlike a raw `-vf` in `customFfmpegFlags` —
   * it cannot collide with / clobber the built-in scale and encoder filters.
   */
  videoFilters: string[];

  /**
   * Start playback at this offset, in seconds (ffmpeg input `-ss` seek). Fast and accurate for
   * seekable inputs. Used by the seekable player to restart a source at a new position.
   */
  startTime?: number;
};

export type Controller = {
  volume: number;
  setVolume(newVolume: number): Promise<boolean>;
};

/**
 * Assemble the ordered video filter chain for the transcoding path: the base `scale`, then any
 * caller-provided `videoFilters` (e.g. burned-in subtitles), then the encoder's own output filters.
 * Pure and order-preserving so the chain is unit-testable without spawning ffmpeg. Empty entries are
 * dropped so a missing encoder filter list doesn't leave a stray comma in the `-vf` spec.
 */
export function buildVideoFilterChain(
  scaleFilter: string,
  videoFilters: readonly string[],
  encoderOutFilters: readonly string[],
): string[] {
  return [scaleFilter, ...videoFilters, ...encoderOutFilters].filter(
    (filter) => filter.length > 0,
  );
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
    frameRate: undefined,
    videoCodec: "H264",
    bitrateVideo: 5000,
    bitrateVideoMax: 7000,
    bitrateAudio: 128,
    includeAudio: true,
    encoder: Encoders.software(),
    hardwareAcceleratedDecoding: false,
    minimizeLatency: false,
    customHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
      Connection: "keep-alive",
    },
    customInputOptions: [],
    customFfmpegFlags: [],
    videoFilters: [],
    startTime: undefined,
  } satisfies PrepareStreamOptions;

  function mergeOptions(opts: Partial<PrepareStreamOptions>) {
    return {
      noTranscoding: opts.noTranscoding ?? defaultOptions.noTranscoding,

      width: isFiniteNonZero(opts.width)
        ? Math.round(opts.width)
        : defaultOptions.width,

      height: isFiniteNonZero(opts.height)
        ? Math.round(opts.height)
        : defaultOptions.height,

      frameRate:
        isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
          ? opts.frameRate
          : defaultOptions.frameRate,

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

      hardwareAcceleratedDecoding:
        opts.hardwareAcceleratedDecoding ??
        defaultOptions.hardwareAcceleratedDecoding,

      minimizeLatency: opts.minimizeLatency ?? defaultOptions.minimizeLatency,

      customHeaders: {
        ...defaultOptions.customHeaders,
        ...opts.customHeaders,
      },
      customInputOptions:
        opts.customInputOptions ?? defaultOptions.customInputOptions,
      customFfmpegFlags:
        opts.customFfmpegFlags ?? defaultOptions.customFfmpegFlags,
      videoFilters: opts.videoFilters ?? defaultOptions.videoFilters,
      startTime:
        isFiniteNonZero(opts.startTime) && opts.startTime > 0
          ? opts.startTime
          : defaultOptions.startTime,
    } satisfies PrepareStreamOptions;
  }

  const mergedOptions = mergeOptions(options);

  let isHttpUrl = false;
  let isHls = false;
  let isSrt = false;

  if (typeof input === "string") {
    isHttpUrl = input.startsWith("http") || input.startsWith("https");
    isHls = input.includes("m3u");
    isSrt = input.startsWith("srt://");
  }

  const output = new PassThrough();

  // command creation
  const command = ffmpeg(input);

  // input seek: `-ss` before `-i` is a fast, accurate input seek for seekable sources.
  if (mergedOptions.startTime !== undefined) {
    command.inputOption("-ss", String(mergedOptions.startTime));
  }

  // input options
  if (
    mergedOptions.customInputOptions &&
    mergedOptions.customInputOptions.length > 0
  ) {
    command.inputOptions(mergedOptions.customInputOptions);
  }

  const { hardwareAcceleratedDecoding, minimizeLatency, customHeaders } =
    mergedOptions;

  // Resolve the encoder up front so its optional `hwPipeline` can drive both the input decode
  // options and the scale filter below. A hardware encoder that declares `hwPipeline` (e.g. VAAPI)
  // lets us decode straight into GPU surfaces and scale on the GPU, avoiding the software `scale`
  // (swscale) that would otherwise download every frame to system memory.
  const encoderSettings = mergedOptions.noTranscoding
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

  if (hardwareAcceleratedDecoding) {
    if (hwPipeline) command.inputOptions(hwPipeline.decodeOptions);
    else command.inputOption("-hwaccel", "auto");
  }

  if (minimizeLatency) {
    command.addOptions(["-fflags nobuffer", "-analyzeduration 0"]);
  }

  if (isHttpUrl) {
    command.inputOption(
      "-headers",
      Object.entries(customHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n"),
    );
    if (!isHls) {
      command.inputOptions([
        "-reconnect 1",
        "-reconnect_at_eof 1",
        "-reconnect_streamed 1",
        "-reconnect_delay_max 4294",
      ]);
    }
  }

  if (isSrt) {
    command.inputOption("-scan_all_pmts 0");
  }

  // general output options
  command.output(output).outputFormat("nut");

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
  command.addOutputOption("-map 0:v");

  if (noTranscoding) {
    command.videoCodec("copy");
  } else {
    if (!encoderSettings)
      throw new Error(`Encoder settings not specified for ${videoCodec}`);

    // One combined `-vf` chain: scale (GPU scale when the encoder declares a hardware pipeline, else
    // software `scale`), then caller filters (e.g. burned subtitles), then the encoder's own output
    // filters. Built by a pure helper so the ordering is unit-testable. On a GPU pipeline the frames
    // are already hardware surfaces, so the encoder's upload/format outFilters are unnecessary.
    command.videoFilter(
      buildVideoFilterChain(
        hwPipeline
          ? hwPipeline.scaleFilter(width, height)
          : `scale=${width}:${height}`,
        mergedOptions.videoFilters,
        hwPipeline ? [] : (encoderSettings.outFilters ?? []),
      ),
    );

    if (frameRate) command.fpsOutput(frameRate);

    command.addOutputOption([
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

    command
      .videoCodec(encoderSettings.name)
      .outputOptions(encoderSettings.options)
      .outputOptions(encoderSettings.globalOptions ?? []);
  }

  // audio setup
  const { includeAudio, bitrateAudio } = mergedOptions;
  if (includeAudio)
    command
      .addOutputOption("-map 0:a:0?")
      .audioChannels(2)
      /*
       * I don't have much surround sound material to test this with,
       * if you do and you have better settings for this, feel free to
       * contribute!
       */
      .addOutputOption("-lfe_mix_level 1")
      .audioFrequency(48000)
      .audioCodec("libopus")
      .audioBitrate(`${bitrateAudio}k`)
      .audioFilters("volume@internal_lib=1.0");

  // Add custom ffmpeg flags
  if (
    mergedOptions.customFfmpegFlags &&
    mergedOptions.customFfmpegFlags.length > 0
  ) {
    command.addOptions(mergedOptions.customFfmpegFlags);
  }

  // exit handling
  const promise = new Promise<void>((resolve, reject) => {
    command.on("error", (err) => {
      if (cancelSignal?.aborted)
        /**
         * fluent-ffmpeg might throw an error when SIGTERM is sent to
         * the process, so we check if the abort signal is triggered
         * and throw that instead
         */
        reject(cancelSignal.reason);
      else reject(err);
    });
    command.on("end", () => resolve());
  });
  promise.catch(() => {});
  cancelSignal?.addEventListener("abort", () => command.kill("SIGTERM"), {
    once: true,
  });

  // realtime control mechanism
  let currentVolume = 1;
  let zmqClientPromise: Promise<Request> | undefined;
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
    const zmqEndpoint = `tcp://${loopbackIp}:42069`;
    command.audioFilters(`azmq=b=${zmqEndpoint.replaceAll(":", "\\\\:")}`);
    zmqClientPromise = import("zeromq").then((zmq) => {
      const client = new zmq.Request({
        sendTimeout: 5000,
        receiveTimeout: 5000,
      });
      client.connect(zmqEndpoint);
      promise.catch(() => {}).finally(() => client.disconnect(zmqEndpoint));
      return client;
    });
  }

  command.run();

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
   * Set stream type as "Go Live" or camera stream
   */
  type: "go-live" | "camera";

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
};

const playStreamDefaultOptions = {
  type: "go-live",
  format: "nut",
  width: (video) => video.width,
  height: (video) => video.height,
  frameRate: (video) => video.framerate_num / video.framerate_den,
  readrateInitialBurst: undefined,
  streamPreview: false,
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
  const { video, audio } = await demux(input, { format: options.format });
  cancelSignal?.throwIfAborted();

  if (!video) throw new Error("No video stream in media");

  const cleanupFuncs: (() => unknown)[] = [];
  const videoCodecMap: Record<number, SupportedVideoCodec> = {
    [AVCodecID.AV_CODEC_ID_H264]: "H264",
    [AVCodecID.AV_CODEC_ID_H265]: "H265",
    [AVCodecID.AV_CODEC_ID_VP8]: "VP8",
    [AVCodecID.AV_CODEC_ID_VP9]: "VP9",
    [AVCodecID.AV_CODEC_ID_AV1]: "AV1",
  };

  if (options.configureConn) {
    conn.setPacketizer(videoCodecMap[video.codec]);
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

  const vStream = new VideoStream(conn);
  video.stream.pipe(vStream);
  // Hoisted so destroy() can tear the audio side down too (see the destroy closure below).
  let aStream: AudioStream | undefined;
  if (audio) {
    const a = new AudioStream(conn);
    aStream = a;
    audio.stream.pipe(a);
    vStream.syncStream = a;

    const burstTime = options.readrateInitialBurst;
    if (typeof burstTime === "number") {
      vStream.sync = false;
      vStream.noSleep = a.noSleep = true;
      const stopBurst = (pts: number) => {
        if (pts < burstTime * 1000) return;
        vStream.sync = true;
        vStream.noSleep = a.noSleep = false;
        vStream.off("pts", stopBurst);
      };
      vStream.on("pts", stopBurst);
    }
  }
  if (options.streamPreview && options.type === "go-live") {
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
        previewLogger.debug(`Decoding a frame took ${decodeEnd - decodeStart}ms`);
        const frame = frames[0];

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
    vStream.once("finish", () => {
      if (cancelSignal?.aborted) return;
      cleanup();
      resolve();
    });
  });

  return {
    done,
    destroy: () => {
      // Force-end this segment (used on seek): drop the source pipes + BOTH streams so the old
      // segment can't keep writing to `conn` while the next one starts (audio desync otherwise). The
      // `finish` handler (or this resolveDone) settles `done`; cleanup is idempotent.
      video.stream.unpipe(vStream);
      vStream.destroy();
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
  } else {
    conn = streamer.voiceConnection.webRtcConn;
    streamer.signalVideo(true);
    stopStream = () => streamer.signalVideo(false);
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
    conn.mediaConnection.setSpeaking(false);
    conn.mediaConnection.setVideoAttributes(false);
  }
}
