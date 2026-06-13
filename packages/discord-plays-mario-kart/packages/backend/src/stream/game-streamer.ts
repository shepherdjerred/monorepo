import { PassThrough, type Readable } from "node:stream";
import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Encoders,
  computeLetterbox,
  type StreamObserver,
} from "@shepherdjerred/discord-video-stream";
import {
  WIDTH,
  HEIGHT,
  N64_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import {
  sinkBufferBytes,
  streamActive,
  streamFfmpegBitrateKbps,
  streamFfmpegFps,
  streamFfmpegSpeedRatio,
  streamFrameIntervalMs,
  streamFrameWriteMs,
  streamHwEncodeEngaged,
} from "#src/observability/metrics.ts";
import {
  createStreamObserver,
  newSessionStats,
  type SessionStats,
} from "#src/stream/stream-observer.ts";
import { withSpan } from "#src/observability/tracing.ts";
import { logger } from "#src/logger.ts";

export type GameStreamerOptions = {
  token: string;
  guildId: string;
  channelId: string;
  // Height of the 16:9 output canvas; the 4:3 game is pillarboxed onto it.
  canvasHeight: number;
  frameRate: number;
  bitrateKbps: number;
  bitrateMaxKbps: number;
  // VAAPI hardware H.264 encoding on an Intel iGPU; falls back to libx264 when off.
  hardwareAcceleration: boolean;
  vaapiDevice: string;
};

// rawvideo input framerate handed to ffmpeg — it assigns presentation
// timestamps from this value, so it must match the emulator's actual tick rate.
const SRC_FPS = N64_FPS;

// Streams the emulator's BGRA frames into a Discord voice channel as a Go-Live
// broadcast, over the voice UDP path. Replaces the userbot + browser
// screen-share. Frames are fed as rawvideo straight into the library's ffmpeg
// (one encode pass).
export class GameStreamer {
  private readonly options: GameStreamerOptions;
  private readonly streamer: Streamer;
  private bgra: PassThrough | undefined;
  private playing: Promise<void> | undefined;
  private active = false;
  private session: SessionStats | undefined;
  private sessionStartedAt = 0;
  private lastPushAt: number | undefined;
  // Serializes start()/stop(). Both are driven fire-and-forget from
  // VoiceStateUpdate callbacks, so without this a stop() landing mid-start()
  // (or a second start()) could interleave at the `await joinVoice` point and
  // orphan the PassThrough/ffmpeg or tear the voice connection. Each call waits
  // for the previous to fully settle before running.
  private opChain: Promise<void> = Promise.resolve();

  constructor(options: GameStreamerOptions) {
    this.options = options;
    this.streamer = new Streamer(new Client());
  }

  async login(): Promise<void> {
    await this.streamer.client.login(this.options.token);
    const user = this.streamer.client.user;
    logger.info(`stream account logged in as ${user?.tag ?? "unknown"}`);
  }

  /** True while a Go-Live broadcast is running and accepting frames. */
  get isStreaming(): boolean {
    return this.active;
  }

  /** Feed one BGRA frame (no-op unless a broadcast is active). */
  pushFrame(frame: Buffer): void {
    if (this.active && this.bgra) {
      const pushAt = performance.now();
      if (this.lastPushAt !== undefined) {
        streamFrameIntervalMs.observe(pushAt - this.lastPushAt);
      }
      this.lastPushAt = pushAt;
      this.bgra.write(frame);
      // A slow write is backpressure showing up before the buffer gauge moves.
      streamFrameWriteMs.observe(performance.now() - pushAt);
      if (this.session) this.session.framesPushed++;
      // Rising buffered bytes ⇒ ffmpeg/encode can't keep up with the frame rate.
      sinkBufferBytes.set(this.bgra.writableLength);
    }
  }

  start(): Promise<void> {
    return this.runExclusive(() => this.doStart());
  }

  stop(): Promise<void> {
    return this.runExclusive(() => this.doStop());
  }

  // Runs `op` only after every previously-queued op settles, so start()/stop()
  // never interleave. The synchronous prefix here (capturing `previous` and
  // replacing `this.opChain`) runs before any await, so concurrent callers queue
  // in call order. The barrier never rejects — a failed op can't wedge the
  // queue — yet the returned promise still rejects so callers see the failure.
  private runExclusive(op: () => Promise<void>): Promise<void> {
    const previous = this.opChain;
    const result = (async (): Promise<void> => {
      await previous;
      await op();
    })();
    this.opChain = this.settle(result);
    return result;
  }

  private async settle(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch {
      // Swallowed so the serialization barrier never wedges on a failed op; the
      // failure is still surfaced to the original caller via runExclusive's
      // returned promise.
    }
  }

  private doStart(): Promise<void> {
    return withSpan("stream.start", () => this.doStartInner());
  }

  private async doStartInner(): Promise<void> {
    if (this.active) return;
    await withSpan("stream.joinVoice", () =>
      this.streamer.joinVoice(this.options.guildId, this.options.channelId),
    );

    const bgra = new PassThrough();
    // Scale the 4:3 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    const session = newSessionStats();
    const observer = createStreamObserver(session);
    const { output, promise } = prepareStream(bgra, {
      observer,
      width: content.width,
      height: content.height,
      pad: canvas,
      frameRate: this.options.frameRate,
      videoCodec: "H264",
      bitrateVideo: this.options.bitrateKbps,
      bitrateVideoMax: this.options.bitrateMaxKbps,
      includeAudio: false,
      minimizeLatency: true,
      customInputOptions: [
        "-f",
        "rawvideo",
        // Frames pushed to the stream arrive BGRA (see wasm-src/PATCHES.md —
        // get_video_buffer's non-idempotent b<->r swap nets BGRA on the tick
        // path). Declaring rgba here swaps red/blue in the broadcast; ffmpeg
        // drops the X byte converting to yuv420p.
        "-pix_fmt",
        "bgra",
        "-video_size",
        `${String(WIDTH)}x${String(HEIGHT)}`,
        "-framerate",
        String(SRC_FPS),
      ],
      // Raw-frame input → keep hardwareAcceleratedDecoding off; Encoders.vaapi()
      // then uploads frames to the GPU (format=nv12|vaapi, hwupload) and encodes
      // with h264_vaapi. Software libx264 is the no-GPU fallback (local/arm64).
      encoder: this.options.hardwareAcceleration
        ? Encoders.vaapi({ device: this.options.vaapiDevice })
        : Encoders.software({
            x264: { preset: "ultrafast", tune: "zerolatency" },
          }),
    });

    // Publish state only once the stream is fully wired; these assignments are
    // synchronous (no await between them), so pushFrame never sees a half-set
    // state.
    this.bgra = bgra;
    this.session = session;
    this.sessionStartedAt = performance.now();
    this.lastPushAt = undefined;
    this.playing = this.runStream(output, promise, observer);
    this.active = true;
    streamActive.set(1);
    logger.info("Go-Live stream started");
  }

  // Drives the Go-Live broadcast and watches the ffmpeg encode for errors.
  // ffmpeg is killed when the frame stream ends on stop(), which is expected
  // and not surfaced as an error.
  private async runStream(
    output: Readable,
    encode: Promise<void>,
    observer: StreamObserver,
  ): Promise<void> {
    try {
      await Promise.all([
        playStream(output, this.streamer, { type: "go-live", observer }),
        encode,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/SIGKILL|signal 9|Exiting normally/i.test(message)) {
        logger.error(`stream error: ${message}`);
      }
    }
  }

  private doStop(): Promise<void> {
    return withSpan("stream.stop", () => this.doStopInner());
  }

  private async doStopInner(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    streamActive.set(0);
    this.bgra?.end();
    this.bgra = undefined;
    sinkBufferBytes.set(0);
    streamFfmpegSpeedRatio.set(0);
    streamFfmpegFps.set(0);
    streamFfmpegBitrateKbps.set(0);
    streamHwEncodeEngaged.set(0);
    this.lastPushAt = undefined;
    // runStream never rejects (it logs internally), so awaiting is safe.
    await this.playing;
    this.playing = undefined;
    this.streamer.leaveVoice();
    const session = this.session;
    this.session = undefined;
    if (session) {
      const durationS = (performance.now() - this.sessionStartedAt) / 1000;
      logger.info("stream session summary", {
        durationS: Math.round(durationS),
        framesPushed: session.framesPushed,
        pushedFps:
          durationS > 0
            ? Math.round((session.framesPushed / durationS) * 10) / 10
            : 0,
        videoFramesSent: session.videoFramesSent,
        lateVideoFrames: session.lateVideoFrames,
        latePct:
          session.videoFramesSent > 0
            ? Math.round(
                (session.lateVideoFrames / session.videoFramesSent) * 1000,
              ) / 10
            : 0,
        lastSpeedRatio: session.lastSpeedRatio,
      });
    }
    logger.info("Go-Live stream stopped");
  }

  destroy(): void {
    this.streamer.client.destroy();
  }
}
