import { PassThrough, type Readable } from "node:stream";
import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Encoders,
} from "@shepherdjerred/discord-video-stream";
import { type Actor, createActor } from "xstate";
import {
  WIDTH,
  HEIGHT,
  GBA_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import { computeLetterbox } from "#src/stream/letterbox.ts";
import { sinkBufferBytes, streamActive } from "#src/observability/metrics.ts";
import { withSpan } from "#src/observability/tracing.ts";
import { logger } from "#src/logger.ts";
import { createOrchestratorMachine } from "./orchestrator-machine.ts";
import type { EncoderHandles, StreamMachineDeps } from "./stream-machine.ts";

export type GameStreamerOptions = {
  token: string;
  guildId: string;
  channelId: string;
  // Height of the 16:9 output canvas; the 3:2 game is pillarboxed onto it.
  canvasHeight: number;
  frameRate: number;
  bitrateKbps: number;
  bitrateMaxKbps: number;
  // VAAPI hardware H.264 encoding on an Intel iGPU; falls back to libx264 when off.
  hardwareAcceleration: boolean;
  vaapiDevice: string;
};

// rawvideo input framerate handed to ffmpeg — it assigns presentation
// timestamps from this value, so it must match the emulator's actual tick rate
// (GBA_FPS), not a rounded 60, or the output drifts ~0.27 fps behind wall-clock.
const SRC_FPS = GBA_FPS;

// Streams the emulator's RGBA frames into a Discord voice channel as a Go-Live
// broadcast, over the voice UDP path.
//
// The lifecycle (join voice → encode → broadcast → leave) is owned by an XState
// machine; this class is a thin facade that supplies the side effects and
// exposes the same start()/stop()/pushFrame() surface the rest of the app uses.
// start()/stop() set the *desired* state and return immediately — the
// orchestrator reconciles it against the in-flight machine, so they are safe to
// call fire-and-forget (and rapidly) from VoiceStateUpdate callbacks without the
// races the old hand-rolled mutex guarded against.
export class GameStreamer {
  private readonly options: GameStreamerOptions;
  private readonly streamer: Streamer;
  private readonly actor: Actor<ReturnType<typeof createOrchestratorMachine>>;
  // Mirror of the machine's live frame sink, kept in sync via subscription so
  // the per-frame hot path is a single null check + write.
  private frameSink: PassThrough | null = null;

  constructor(options: GameStreamerOptions) {
    this.options = options;
    this.streamer = new Streamer(new Client());

    const machine = createOrchestratorMachine(this.deps());
    this.actor = createActor(machine);
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

  /** True while a Go-Live broadcast is live and accepting frames. */
  get isStreaming(): boolean {
    return this.frameSink !== null;
  }

  /** Feed one RGBA frame (no-op unless a broadcast is live). */
  pushFrame(frame: Buffer): void {
    if (this.frameSink) {
      this.frameSink.write(frame);
      // Rising buffered bytes ⇒ ffmpeg/encode can't keep up with the frame rate.
      sinkBufferBytes.set(this.frameSink.writableLength);
    }
  }

  /** Request that the broadcast be running. Resolves immediately. */
  start(): Promise<void> {
    this.actor.send({ type: "SET_DESIRED", desired: true });
    return Promise.resolve();
  }

  /** Request that the broadcast be stopped. Resolves immediately. */
  stop(): Promise<void> {
    this.actor.send({ type: "SET_DESIRED", desired: false });
    return Promise.resolve();
  }

  destroy(): void {
    this.actor.stop();
    this.streamer.client.destroy();
  }

  // ---- side effects injected into the machine ----

  private deps(): StreamMachineDeps {
    return {
      joinVoice: (signal) =>
        withSpan("stream.joinVoice", async () => {
          await this.streamer.joinVoice(
            this.options.guildId,
            this.options.channelId,
          );
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
        }),
    };
  }

  private buildEncoder(): EncoderHandles {
    const rgba = new PassThrough();
    // Scale the 3:2 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    const { output, promise } = prepareStream(rgba, {
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
        "-pix_fmt",
        "rgba",
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
    return { sink: rgba, output, playing: promise };
  }

  // Drives the Go-Live broadcast and watches the ffmpeg encode for errors.
  // ffmpeg is killed when the frame stream ends on stop(), which is expected and
  // not surfaced as an error. Resolves when the stream ends for any reason.
  private async runStream(
    output: Readable,
    encode: Promise<void>,
  ): Promise<void> {
    try {
      await Promise.all([
        playStream(output, this.streamer, { type: "go-live" }),
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
