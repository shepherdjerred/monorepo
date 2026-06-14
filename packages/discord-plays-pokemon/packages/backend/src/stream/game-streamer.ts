import { PassThrough, type Readable } from "node:stream";
import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Encoders,
  computeLetterbox,
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
  GBA_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import { sinkBufferBytes, streamActive } from "#src/observability/metrics.ts";
import { withSpan } from "#src/observability/tracing.ts";
import { logger } from "#src/logger.ts";
import {
  createAudioTransport,
  type AudioTransport,
} from "#src/stream/audio-transport.ts";

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
  private readonly actor: Actor<ReturnType<typeof createDesiredStreamMachine>>;
  // Mirror of the machine's live frame sink, kept in sync via subscription so
  // the per-frame hot path is a single null check + write.
  private frameSink: PassThrough | null = null;
  // Loopback PCM transport — sink fed by `pushAudio`, piped to ffmpeg. Created
  // alongside the encoder and torn down when the broadcast stops; mirrors how
  // discord-plays-mario-kart's GameStreamer handles its audio path.
  private audioTransport: AudioTransport | null = null;

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
      const next = snapshot.context.frameSink;
      // The machine ends the video sink when a broadcast stops; tear the audio
      // transport down in lockstep so its socket/server don't leak.
      if (next === null) this.teardownAudio();
      this.frameSink = next;
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

  /** Feed Float32 LRLR PCM (interleaved, native ~13379 Hz) to the broadcast.
   * No-op when idle. Buffer format matches what `Emulator#onAudio` provides
   * (`DrainResult.pcm`). */
  pushAudio(pcm: Buffer): void {
    if (this.audioTransport !== null) this.audioTransport.sink.write(pcm);
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
    this.teardownAudio();
    this.streamer.client.destroy();
  }

  /** Tear down the loopback audio transport (sink + socket + server). Idempotent. */
  private teardownAudio(): void {
    if (this.audioTransport !== null) {
      this.audioTransport.close();
      this.audioTransport = null;
    }
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
        withSpan("stream.prepareEncoder", () => this.buildEncoder()),
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
      onFailure: ({ attempt, maxRetries, error }) => {
        logger.error(
          `stream failed (attempt ${String(attempt)} of ${String(
            maxRetries,
          )}): ${error ?? "unknown"}`,
        );
      },
    };
  }

  private async buildEncoder(): Promise<EncoderHandles> {
    const rgba = new PassThrough();
    // Scale the 3:2 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    // Stand up the loopback audio transport before ffmpeg launches so its
    // client connect succeeds immediately. pushAudio writes Float32 LRLR PCM
    // into the transport sink; ffmpeg dials the loopback URL once and muxes
    // the bytes into the broadcast.
    const audioTransport = await createAudioTransport();
    this.audioTransport = audioTransport;
    const { output, promise } = prepareStream(rgba, {
      width: content.width,
      height: content.height,
      pad: canvas,
      frameRate: this.options.frameRate,
      videoCodec: "H264",
      bitrateVideo: this.options.bitrateKbps,
      bitrateVideoMax: this.options.bitrateMaxKbps,
      includeAudio: true,
      // Game audio is the m4a engine's un-quantised Float32 mixer output (see
      // `audio/m4a-driver.ts`); it can't ride the rawvideo stdin so ffmpeg
      // reads it from the loopback socket and muxes it into the broadcast.
      audioInput: {
        source: audioTransport.source,
        inputOptions: audioTransport.inputOptions,
      },
      bitrateAudio: 96,
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
