import type { PassThrough, Readable } from "node:stream";
import type { Client } from "discord.js-selfbot-v13";
import { Streamer, playStream } from "@shepherdjerred/discord-video-stream";
import type { PlayStreamOptions } from "@shepherdjerred/discord-video-stream";
import { createDesiredStreamMachine } from "@shepherdjerred/discord-stream-lifecycle";
import type {
  EncoderHandles,
  RawGoLiveDeps,
} from "@shepherdjerred/discord-stream-lifecycle/types";
import { createTransitionLogInspector } from "@shepherdjerred/discord-stream-lifecycle/debug/transition-logger";
import { type Actor, createActor } from "xstate";
import type { Logger } from "#src/logger.ts";
import { streamActive } from "#src/observability/metrics.ts";
import { withSpan } from "#src/observability/tracing.ts";
import type { AudioTransport } from "#src/stream/audio-transport.ts";

export type GameStreamerBaseOptions = {
  /**
   * Pre-built, already-logged-in `discord.js-selfbot-v13` client (typically supplied
   * by the userbot pool). The streamer drives voice/video through this client and
   * does not own its lifecycle — callers manage login/destroy.
   */
  selfbotClient: Client;
  guildId: string;
  channelId: string;
  logger: Logger;
};

// Streams the emulator's raw frames into a Discord voice channel as a Go-Live
// broadcast, over the voice UDP path.
//
// The lifecycle (join voice → encode → broadcast → leave) is owned by an XState
// machine; this class is a thin facade that supplies the side effects and
// exposes the same start()/stop()/pushFrame() surface the rest of the app uses.
// start()/stop() set the *desired* state and return immediately — the
// orchestrator reconciles it against the in-flight machine, so they are safe to
// call fire-and-forget (and rapidly) from VoiceStateUpdate callbacks without the
// races the old hand-rolled mutex guarded against.
//
// Each game subclasses this: it supplies `buildEncoder()` (game-specific ffmpeg
// wiring / pixel format / audio format) and `pushFrame()`, and may override the
// stream-observer / session hooks below.
export abstract class GameStreamerBase {
  protected readonly streamer: Streamer;
  protected readonly logger: Logger;
  private readonly actor: Actor<ReturnType<typeof createDesiredStreamMachine>>;
  // Mirror of the machine's live frame sink, kept in sync via subscription so
  // the per-frame hot path is a single null check + write.
  protected frameSink: PassThrough | null = null;
  // Loopback PCM transport — sink fed by `pushAudio`, piped to ffmpeg. Created
  // in the subclass's buildEncoder() and torn down when the broadcast stops.
  protected audioTransport: AudioTransport | null = null;

  constructor(options: GameStreamerBaseOptions) {
    this.logger = options.logger;
    this.streamer = new Streamer(options.selfbotClient);

    const machine = createDesiredStreamMachine(this.deps());
    this.actor = createActor(machine, {
      input: {
        voiceTarget: {
          guildId: options.guildId,
          channelId: options.channelId,
        },
      },
      // Logs each state transition of the desired-stream machine and its invoked rawGoLive
      // child (join/prepare/stream/leave), including transient states, to aid debugging.
      inspect: createTransitionLogInspector({
        log: {
          info: (message, meta) => {
            this.logger.info(message, meta);
          },
        },
        label: options.guildId,
      }),
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

  /**
   * Selfbot login is owned by the userbot pool now — this no-op shim remains so
   * existing callers don't change shape during the migration.
   */
  async login(): Promise<void> {
    const user = this.streamer.client.user;
    this.logger.info(
      `stream account already logged in as ${user?.tag ?? "unknown"}`,
    );
    await Promise.resolve();
  }

  /** True while a Go-Live broadcast is live and accepting frames. */
  get isStreaming(): boolean {
    return this.frameSink !== null;
  }

  /** Feed one raw frame to the broadcast (no-op unless a broadcast is live). */
  abstract pushFrame(frame: Buffer): void;

  /** Feed raw PCM to the broadcast. No-op when idle. */
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

  /** Stop the actor and tear down resources. Subclasses customize via the hooks below. */
  destroy(): void {
    this.beforeActorStop();
    this.actor.stop();
    this.teardownAudio();
    this.destroyClient();
  }

  /**
   * Runs before the actor is stopped in destroy(). Default no-op; mario-kart
   * sends a SHUTDOWN event so the machine tears its broadcast down cleanly.
   */
  protected beforeActorStop(): void {
    // no-op by default
  }

  /**
   * Destroy the underlying selfbot client. Default is a bare destroy();
   * mario-kart overrides to swallow the null-connection throw discord.js-selfbot-v13
   * raises when the gateway never fully connected.
   */
  protected destroyClient(): void {
    this.streamer.client.destroy();
  }

  /** Send an event to the desired-stream machine (for subclass teardown hooks). */
  protected sendToActor(event: { type: "SHUTDOWN" }): void {
    this.actor.send(event);
  }

  /** Tear down the loopback audio transport (sink + socket + server). Idempotent. */
  protected teardownAudio(): void {
    if (this.audioTransport !== null) {
      this.audioTransport.close();
      this.audioTransport = null;
    }
  }

  // ---- game-specific hooks ----

  /**
   * Build the ffmpeg encoder + audio transport for one broadcast. Runs inside
   * the machine's `prepareEncoder` step. The subclass sets `this.audioTransport`
   * here and returns the encoder handles.
   */
  protected abstract buildEncoder(): Promise<EncoderHandles>;

  /**
   * Extra work after the library's `leaveVoice` runs (reset metrics, log a
   * session summary, notify listeners). Default no-op; mario-kart overrides.
   */
  protected afterLeaveVoice(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Options passed to playStream for the broadcast. Default is a bare go-live;
   * mario-kart overrides to attach its StreamObserver.
   */
  protected playOptions(): Partial<PlayStreamOptions> {
    return { type: "go-live" };
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
          await this.afterLeaveVoice();
        }),
      onFailure: ({ attempt, maxRetries, error }) => {
        this.logger.error(
          `stream failed (attempt ${String(attempt)} of ${String(
            maxRetries,
          )}): ${error ?? "unknown"}`,
        );
      },
    };
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
        playStream(output, this.streamer, this.playOptions()),
        encode,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/SIGKILL|signal 9|Exiting normally/i.test(message)) {
        this.logger.error(`stream error: ${message}`);
      }
    }
  }
}
