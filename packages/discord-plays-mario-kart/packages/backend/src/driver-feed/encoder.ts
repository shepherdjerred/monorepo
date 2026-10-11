// The driver feed's own ffmpeg process: raw BGRA frames in, H.264 in FLV out.
//
// This deliberately does NOT go through discord-video-stream's `prepareStream`.
// That is the library's only spawn entry point and it muxes to NUT for Discord's
// demuxer, pillarboxes onto a 16:9 canvas, and attaches an audio input — none of
// which a browser decoder wants. The encoder *settings* are still shared: the
// VAAPI flag arrays below are lifted from `Encoders.vaapi()` and the rawvideo
// input description mirrors `GameStreamer.buildEncoder`, so both paths describe
// the emulator's output identically.
//
// A second encode is affordable: h264_vaapi benchmarks at ~16.7x realtime in-pod
// and ffmpeg runs out-of-process, so it does not contend with the Bun main thread
// (where the emulator's ~30 ms p95 already sits against a 33 ms budget).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as Sentry from "@sentry/bun";
import { DISPLAY_ASPECT } from "#src/emulator/constants.ts";
import { frameBytes, type FrameFormat } from "#src/engine/format.ts";
import { LatestFrameSink } from "#src/stream/latest-frame-sink.ts";
import {
  driverFeedAccessUnitBytes,
  driverFeedEncoderRunning,
  driverFeedFrameToUnitMs,
  driverFeedFramesEvictedTotal,
  driverFeedInputToUnitMs,
  driverFeedLatencyCorrelationFailuresTotal,
  driverFeedSinkFrames,
} from "#src/observability/metrics.ts";
import { logger } from "#src/logger.ts";
import type { AccessUnit } from "./annex-b.ts";
import { FlvAccessUnitReader } from "./flv.ts";
import {
  DriverFeedLatencyTracker,
  type DriverFeedFrameTiming,
} from "./latency-tracker.ts";

/**
 * The sink's minimum: one frame in the pipe's read buffer and one queued. Any
 * deeper and a briefly slow ffmpeg leaves a standing queue of stale frames
 * (33 ms each) in front of every new one; drivers want the newest frame, so
 * the oldest is evicted instead.
 */
const MAX_BUFFERED_FRAMES = 2;

// Profile and level are forced so the codec string handed to the browser's
// VideoDecoder is exact rather than inferred. main (profile_idc 77 = 0x4D), no
// constraint flags, level 4.0 (level_idc 40 = 0x28) — 4.0 covers every output
// size the config permits, up to 1920x1080@30.
//
// The level is spelled "40", not "4.0": h264_vaapi parses -level as an integer
// level_idc whose named constants are "4"/"4.1"/..., so "4.0" is rejected there,
// while both x264 and VAAPI accept the numeric form.
const H264_PROFILE = "main";
const H264_LEVEL = "40";
export const H264_CODEC_STRING = "avc1.4D4028";

export type DriverFeedEncoderOptions = {
  /** What the engine delivers: frame size and rate. Every frame is encoded. */
  readonly source: FrameFormat;
  /** Square-pixel output height; width is derived from the 4:3 display aspect. */
  readonly outputHeight: number;
  readonly bitrateKbps: number;
  readonly bitrateMaxKbps: number;
  readonly keyframeIntervalFrames: number;
  readonly hardwareAcceleration: boolean;
  readonly vaapiDevice: string;
  readonly encoderAsyncDepth: number;
};

export type DriverFeedOutputSize = {
  readonly width: number;
  readonly height: number;
};

/**
 * Size the 4:3 picture in square pixels at `height`, rounding width to an even
 * number (H.264 4:2:0 requires it). This aspect-corrects the wasm core's
 * anamorphic 640x240 frame; the native 640x480 frame is already square.
 *
 * Unlike the Go-Live path there is no pillarbox: the browser lays the canvas out
 * with CSS, so sending black bars would just waste bitrate.
 */
export function driverFeedOutputSize(height: number): DriverFeedOutputSize {
  const width = Math.round((height * DISPLAY_ASPECT) / 2) * 2;
  return { width, height: Math.round(height / 2) * 2 };
}

/**
 * Build the ffmpeg argument vector. Exported so tests can assert the flags that
 * carry latency or correctness meaning without spawning anything.
 */
export function buildDriverFeedArgs(
  options: DriverFeedEncoderOptions,
): string[] {
  const out = driverFeedOutputSize(options.outputHeight);
  const scaleFilter = `scale=${String(out.width)}:${String(out.height)}`;
  // One frame of slack. A small bufsize keeps the VBR rate controller from
  // smoothing bitrate across many frames, which would show up as latency.
  const frameRate = options.source.fps;
  const bufsizeKbits = Math.max(
    Math.round(options.bitrateKbps / frameRate) * 2,
    32,
  );

  const globalOptions = options.hardwareAcceleration
    ? [
        "-init_hw_device",
        `vaapi=va:${options.vaapiDevice}`,
        "-filter_hw_device",
        "va",
      ]
    : [];
  const videoFilters = options.hardwareAcceleration
    ? [scaleFilter, "format=nv12|vaapi", "hwupload"]
    : [scaleFilter, "format=yuv420p"];
  const codecOptions = options.hardwareAcceleration
    ? [
        "-c:v",
        "h264_vaapi",
        // VBR so -b:v/-maxrate/-bufsize are honored; h264_vaapi defaults to AVBR
        // and logs "Buffering settings are ignored".
        "-rc_mode",
        "VBR",
        "-async_depth",
        String(options.encoderAsyncDepth),
      ]
    : [
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        // Make -g produce real IDRs rather than recovery points, so every
        // keyframe is a decoder entry point.
        "-forced-idr",
        "1",
      ];

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...globalOptions,
    // Input: raw frames on stdin. BGRA, not RGBA: the wasm core's
    // get_video_buffer nets BGRA on the tick path (wasm-src/PATCHES.md), and
    // the native port reads its framebuffer back as BGRA.
    "-fflags",
    "nobuffer",
    "-analyzeduration",
    "0",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "bgra",
    "-video_size",
    `${String(options.source.width)}x${String(options.source.height)}`,
    "-framerate",
    String(frameRate),
    // Raw BGRA is fully described above; the minimum legal probe size stops
    // ffmpeg waiting on a live pipe before it starts encoding.
    "-probesize",
    "32",
    "-i",
    "pipe:0",
    "-an",
    "-vf",
    videoFilters.join(","),
    "-r",
    String(frameRate),
    ...codecOptions,
    "-profile:v",
    H264_PROFILE,
    "-level",
    H264_LEVEL,
    "-b:v",
    `${String(options.bitrateKbps)}k`,
    "-maxrate",
    `${String(options.bitrateMaxKbps)}k`,
    "-bufsize",
    `${String(bufsizeKbits)}k`,
    // No B-frames: output order equals input order, so access units leave the
    // encoder in presentation order and the client never has to reorder.
    "-bf",
    "0",
    "-g",
    String(options.keyframeIntervalFrames),
    "-keyint_min",
    String(options.keyframeIntervalFrames),
    "-flush_packets",
    "1",
    // FLV, not raw H.264: each tag states its size, so the reader can hand a
    // frame on the moment its last byte arrives. A raw elementary stream has no
    // boundaries, and closing an access unit there means waiting for the next
    // one — a full frame interval. The flags stop the muxer seeking back to
    // patch duration/size into a pipe and skip the metadata tag nobody reads.
    "-f",
    "flv",
    "-flvflags",
    "no_duration_filesize+no_metadata",
    "pipe:1",
  ];
}

export type DriverFeedEncoderCallbacks = {
  readonly onAccessUnit: (unit: AccessUnit) => void;
};

export type DriverFeedProcessFactory = (
  executable: string,
  args: string[],
) => ChildProcessWithoutNullStreams;

const spawnDriverFeedProcess: DriverFeedProcessFactory = (executable, args) =>
  spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

/**
 * Owns the second ffmpeg process and the frame sink feeding it.
 *
 * Failures are contained rather than propagated: this feed is additive, so a
 * dead encoder must never take down the Go-Live stream that spectators are
 * watching. Everything is logged and reported, and `running` goes false.
 */
export class DriverFeedEncoder {
  private readonly options: DriverFeedEncoderOptions;
  private readonly callbacks: DriverFeedEncoderCallbacks;
  private readonly processFactory: DriverFeedProcessFactory;
  private readonly reader = new FlvAccessUnitReader();
  private readonly latency = new DriverFeedLatencyTracker({
    frameToUnit: (ms) => {
      driverFeedFrameToUnitMs.observe(ms);
    },
    inputToUnit: (ms) => {
      driverFeedInputToUnitMs.observe(ms);
    },
    correlationFailure: () => {
      driverFeedLatencyCorrelationFailuresTotal.inc();
    },
  });
  private sink: LatestFrameSink<DriverFeedFrameTiming> | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private stopping = false;
  /** Single-use: the reader carries stream state that must not span processes. */
  private started = false;
  private warnedSizeMismatch = false;
  private readonly frameBytes: number;

  constructor(
    options: DriverFeedEncoderOptions,
    callbacks: DriverFeedEncoderCallbacks,
    processFactory: DriverFeedProcessFactory = spawnDriverFeedProcess,
  ) {
    this.options = options;
    this.callbacks = callbacks;
    this.processFactory = processFactory;
    this.frameBytes = frameBytes(options.source);
  }

  get running(): boolean {
    return this.child !== undefined && !this.stopping;
  }

  get outputSize(): DriverFeedOutputSize {
    return driverFeedOutputSize(this.options.outputHeight);
  }

  start(): void {
    if (this.started) {
      throw new Error(
        "DriverFeedEncoder is single-use; construct a new one per session",
      );
    }
    this.started = true;
    this.stopping = false;
    const args = buildDriverFeedArgs(this.options);
    const executable = Bun.env["FFMPEG_PATH"] ?? "ffmpeg";
    logger.info("driver feed encoder starting", {
      output: this.outputSize,
      hardwareAcceleration: this.options.hardwareAcceleration,
    });

    const child = this.processFactory(executable, args);
    this.child = child;
    driverFeedEncoderRunning.set(1);

    const sink = new LatestFrameSink<DriverFeedFrameTiming>({
      frameBytes: this.frameBytes,
      maxBufferedFrames: MAX_BUFFERED_FRAMES,
      onFrameEvicted: () => {
        driverFeedFramesEvictedTotal.inc();
      },
      onFrameDelivered: (timing) => {
        // Only frames that reach ffmpeg can become access units, so this is
        // where the frame-to-unit pairing starts.
        if (timing !== undefined) this.latency.frameDelivered(timing);
      },
    });
    this.sink = sink;
    sink.pipe(child.stdin);

    child.stdout.on("data", (chunk: unknown) => {
      // A stopped process can still have data queued in Node's stream. Its
      // output belongs to the old session and must never reach the new hub.
      if (this.child !== child || this.stopping) return;
      if (!Buffer.isBuffer(chunk)) {
        throw new TypeError("ffmpeg stdout emitted a non-Buffer chunk");
      }
      let units: AccessUnit[];
      try {
        units = this.reader.push(chunk);
      } catch (error) {
        // FLV has no resync point, so a framing error ends this encoder. The
        // Go-Live stream is unaffected; the feed is down until the next session.
        logger.error("driver feed output is not valid FLV", error);
        Sentry.captureException(error);
        this.stop();
        return;
      }
      for (const unit of units) {
        this.latency.unitReady();
        driverFeedAccessUnitBytes.observe(unit.bytes.length);
        this.callbacks.onAccessUnit(unit);
      }
    });
    child.stderr.on("data", (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) {
        throw new TypeError("ffmpeg stderr emitted a non-Buffer chunk");
      }
      logger.error("driver feed ffmpeg", { stderr: chunk.toString().trim() });
    });
    child.stdin.on("error", (error) => {
      // EPIPE once ffmpeg exits is expected during teardown; anything else is not.
      if (this.stopping) return;
      logger.error("driver feed ffmpeg stdin failed", error);
    });
    child.on("error", (error) => {
      logger.error("driver feed ffmpeg failed to spawn", error);
      Sentry.captureException(error);
      this.markStopped(child);
    });
    child.on("exit", (code, signal) => {
      if (!this.stopping) {
        // Unexpected: log loudly but keep the Go-Live stream alive.
        logger.error("driver feed ffmpeg exited unexpectedly", {
          code,
          signal,
        });
        Sentry.captureException(
          new Error(
            `driver feed ffmpeg exited unexpectedly (code=${String(code)} signal=${String(signal)})`,
          ),
        );
      }
      this.markStopped(child);
    });
  }

  /**
   * Feed one overlay-composited BGRA frame. No-op when the encoder is down.
   * `inputReceivedAtMs` is the receipt time of the earliest input this frame is
   * the first to reflect, on the InputLatencyTracker clock.
   */
  pushFrame(frame: Buffer, inputReceivedAtMs?: number): void {
    const sink = this.sink;
    if (sink === undefined || !this.running) return;
    if (frame.length !== this.frameBytes) {
      // ffmpeg was told a fixed -video_size, so a VI mode change would desync
      // the whole raw stream rather than produce one bad frame. Drop it. The
      // Go-Live path is sized the same way and each engine keeps one frame
      // size, so this firing at all means an assumption both encoders share
      // has broken.
      if (!this.warnedSizeMismatch) {
        this.warnedSizeMismatch = true;
        logger.warn("driver feed dropping frames of unexpected size", {
          expected: this.frameBytes,
          received: frame.length,
        });
      }
      driverFeedFramesEvictedTotal.inc();
      return;
    }
    sink.writeFrame(frame, {
      pushedAtMs: performance.timeOrigin + performance.now(),
      ...(inputReceivedAtMs === undefined ? {} : { inputReceivedAtMs }),
    });
    driverFeedSinkFrames.set(sink.bufferedBytes / this.frameBytes);
  }

  stop(): void {
    const child = this.child;
    if (child === undefined) return;
    this.stopping = true;
    try {
      this.sink?.end();
    } catch (error) {
      logger.warn("driver feed sink end failed", error);
    }
    child.kill("SIGTERM");
    this.markStopped(child);
  }

  private markStopped(child: ChildProcessWithoutNullStreams): void {
    // Ignore a late error/exit from a process that stop() already invalidated.
    // In particular it must not zero the process-global running gauge after a
    // replacement encoder has started.
    if (this.child !== child) return;
    this.child = undefined;
    this.sink = undefined;
    driverFeedEncoderRunning.set(0);
  }
}
