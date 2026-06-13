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
import { createDesiredStreamMachine } from "@shepherdjerred/discord-stream-lifecycle";
import type {
  EncoderHandles,
  RawGoLiveDeps,
} from "@shepherdjerred/discord-stream-lifecycle/types.ts";
import { type Actor, createActor } from "xstate";
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
// broadcast, over the voice UDP path.
//
// The lifecycle (join voice → encode → broadcast → leave) is owned by the
// shared stream lifecycle state machine. This class supplies Mario Kart-specific
// side effects and preserves the richer ffmpeg/session metrics.
export class GameStreamer {
  private readonly options: GameStreamerOptions;
  private readonly streamer: Streamer;
  private readonly actor: Actor<ReturnType<typeof createDesiredStreamMachine>>;
  private frameSink: PassThrough | null = null;
  private session: SessionStats | undefined;
  private sessionStartedAt = 0;
  private lastPushAt: number | undefined;
  private streamObserver: StreamObserver | undefined;

  constructor(options: GameStreamerOptions) {
    this.options = options;
    this.streamer = new Streamer(new Client());

    const machine = createDesiredStreamMachine(this.deps());
    this.actor = createActor(machine, {
      input: {
        voiceTarget: {
          guildId: this.options.guildId,
          channelId: this.options.channelId,
        },
      },
    });
    this.actor.subscribe((snapshot) => {
      this.frameSink = snapshot.context.frameSink;
      streamActive.set(this.frameSink === null ? 0 : 1);
    });
    this.actor.start();
  }

  async login(): Promise<void> {
    await this.streamer.client.login(this.options.token);
    const user = this.streamer.client.user;
    logger.info(`stream account logged in as ${user?.tag ?? "unknown"}`);
  }

  /** True while a Go-Live broadcast is running and accepting frames. */
  get isStreaming(): boolean {
    return this.frameSink !== null;
  }

  /** Feed one BGRA frame (no-op unless a broadcast is active). */
  pushFrame(frame: Buffer): void {
    if (this.frameSink) {
      const pushAt = performance.now();
      if (this.lastPushAt !== undefined) {
        streamFrameIntervalMs.observe(pushAt - this.lastPushAt);
      }
      this.lastPushAt = pushAt;
      this.frameSink.write(frame);
      // A slow write is backpressure showing up before the buffer gauge moves.
      streamFrameWriteMs.observe(performance.now() - pushAt);
      if (this.session) this.session.framesPushed++;
      // Rising buffered bytes ⇒ ffmpeg/encode can't keep up with the frame rate.
      sinkBufferBytes.set(this.frameSink.writableLength);
    }
  }

  start(): Promise<void> {
    this.actor.send({ type: "SET_DESIRED", desired: true });
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.actor.send({ type: "SET_DESIRED", desired: false });
    return Promise.resolve();
  }

  destroy(): void {
    this.actor.send({ type: "SHUTDOWN" });
    this.actor.stop();
    this.streamer.client.destroy();
  }

  // ---- side effects injected into the machine ----

  private deps(): RawGoLiveDeps {
    return {
      joinVoice: ({ target }, signal) =>
        withSpan("stream.joinVoice", async () => {
          await this.streamer.joinVoice(target.guildId, target.channelId);
          // The library's joinVoice cannot be cancelled mid-flight. If STOP arrived
          // while we were connecting, the actor was aborted and leaveVoice already ran;
          // tear down the connection we just established so it isn't orphaned.
          if (signal.aborted) {
            this.streamer.leaveVoice();
          }
        }),
      prepareEncoder: () =>
        withSpan("stream.prepareEncoder", () =>
          Promise.resolve(this.buildEncoder()),
        ),
      runStream: ({ output, playing }) => this.runStream(output, playing),
      leaveVoice: (playing) =>
        withSpan("stream.leaveVoice", async () => {
          if (playing) {
            try {
              await playing;
            } catch {
              // ffmpeg is SIGKILLed when the frame stream ends on stop; the encode
              // promise rejecting here is expected and not an error.
            }
          }
          this.streamer.leaveVoice();
          this.resetStreamMetrics();
          this.logSessionSummary();
          logger.info("Go-Live stream stopped");
        }),
      onFailure: ({ attempt, maxRetries, error }) => {
        logger.error(
          `stream failed (attempt ${String(attempt)} of ${String(
            maxRetries,
          )}): ${error ?? "unknown"}`,
        );
      },
    };
  }

  private buildEncoder(): EncoderHandles {
    const bgra = new PassThrough();
    // Scale the 4:3 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    const session = newSessionStats();
    const observer = createStreamObserver(session);
    this.session = session;
    this.sessionStartedAt = performance.now();
    this.lastPushAt = undefined;
    this.streamObserver = observer;

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

    logger.info("Go-Live stream started");
    return { sink: bgra, output, playing: promise };
  }

  private resetStreamMetrics(): void {
    sinkBufferBytes.set(0);
    streamFfmpegSpeedRatio.set(0);
    streamFfmpegFps.set(0);
    streamFfmpegBitrateKbps.set(0);
    streamHwEncodeEngaged.set(0);
    this.lastPushAt = undefined;
    this.streamObserver = undefined;
  }

  private logSessionSummary(): void {
    const session = this.session;
    this.session = undefined;
    if (!session) return;

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

  private playOptions():
    | { readonly type: "go-live"; readonly observer: StreamObserver }
    | { readonly type: "go-live" } {
    if (this.streamObserver) {
      return { type: "go-live", observer: this.streamObserver };
    }
    return { type: "go-live" };
  }

  // Drives the Go-Live broadcast and watches the ffmpeg encode for errors.
  // ffmpeg is killed when the frame stream ends on stop(), which is expected
  // and not surfaced as an error.
  private async runStream(
    output: Readable,
    encode: Promise<void>,
  ): Promise<void> {
    try {
      await Promise.all([
        playStream(output, this.streamer, this.playOptions()),
        encode,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/SIGKILL|signal 9|Exiting normally/i.test(message)) {
        logger.error(`stream error: ${message}`);
      }
    }
  }
}
