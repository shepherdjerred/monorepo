import { PassThrough, type Readable } from "node:stream";
import type { Client } from "discord.js-selfbot-v13";
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
} from "@shepherdjerred/discord-stream-lifecycle/types";
import { createTransitionLogInspector } from "@shepherdjerred/discord-stream-lifecycle/debug/transition-logger";
import { type Actor, createActor } from "xstate";
import {
  WIDTH,
  HEIGHT,
  N64_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import {
  createAudioTransport,
  type AudioTransport,
} from "#src/stream/audio-transport.ts";
import {
  sinkBufferBytes,
  streamActive,
  streamFfmpegBitrateKbps,
  streamFfmpegFps,
  streamFfmpegSpeedRatio,
  streamFrameIntervalMs,
  streamFramesDroppedTotal,
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
  /**
   * Pre-built, already-logged-in `discord.js-selfbot-v13` client (typically supplied
   * by the userbot pool). The streamer drives voice/video through this client and
   * does not own its lifecycle — callers manage login/destroy.
   */
  selfbotClient: Client;
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
  onSessionEnded?: () => void | Promise<void>;
};

export async function notifyStreamSessionEnded(
  hadSession: boolean,
  onSessionEnded?: () => void | Promise<void>,
): Promise<void> {
  if (hadSession && onSessionEnded !== undefined) {
    await onSessionEnded();
  }
}

// rawvideo input framerate handed to ffmpeg — it assigns presentation
// timestamps from this value, so it must match the emulator's actual tick rate.
const SRC_FPS = N64_FPS;

// Cap on the bytes allowed to sit in the PassThrough feeding ffmpeg before
// pushFrame starts dropping the newest frame. The emulator produces frames at a
// fixed rate; if the encode/Discord-send path dips below realtime (e.g. the single
// JS event loop is busy emulating), an *unbounded* queue pushes the broadcast
// seconds — even minutes — behind live (a 3.5 GB / ~3 min backlog was observed in
// prod), so controller input lag grows without bound and the pod risks OOM against
// its memory limit. Bounding the queue trades frame rate for latency: under a slow
// consumer the stream degrades to fewer fps at low lag instead of staying
// real-time-rate but ever further behind. ~3 frames ≈ 100 ms at 30 fps.
export const MAX_SINK_BUFFER_BYTES = WIDTH * HEIGHT * 4 * 3;

/**
 * Whether to drop a new frame rather than enqueue it: true once the bytes already
 * waiting in the ffmpeg input PassThrough are at/above the latency budget. Exported
 * for tests. (The PassThrough's highWaterMark is far below one frame, so `write()`'s
 * own backpressure return is always `false` and unusable as a signal — the queued
 * byte count is.)
 */
export function shouldDropFrame(queuedBytes: number): boolean {
  return queuedBytes >= MAX_SINK_BUFFER_BYTES;
}

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
  // Audio side: a loopback PCM transport (sink fed by pushAudio) piped to ffmpeg.
  // Created with the encoder, torn down when the broadcast stops.
  private audioTransport: AudioTransport | null = null;
  private session: SessionStats | undefined;
  private sessionStartedAt = 0;
  private lastPushAt: number | undefined;
  private streamObserver: StreamObserver | undefined;

  constructor(options: GameStreamerOptions) {
    this.options = options;
    this.streamer = new Streamer(options.selfbotClient);

    const machine = createDesiredStreamMachine(this.deps());
    this.actor = createActor(machine, {
      input: {
        voiceTarget: {
          guildId: this.options.guildId,
          channelId: this.options.channelId,
        },
      },
      // Logs each state transition of the desired-stream machine and its invoked rawGoLive
      // child (join/prepare/stream/leave), including transient states, to aid debugging.
      inspect: createTransitionLogInspector({
        log: {
          info: (message, meta) => {
            logger.info(message, meta);
          },
        },
        label: this.options.guildId,
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

  async login(): Promise<void> {
    const user = this.streamer.client.user;
    logger.info(
      `stream account already logged in as ${user?.tag ?? "unknown"}`,
    );
    await Promise.resolve();
  }

  /** True while a Go-Live broadcast is running and accepting frames. */
  get isStreaming(): boolean {
    return this.frameSink !== null;
  }

  /** Feed one BGRA frame (no-op unless a broadcast is active). */
  pushFrame(frame: Buffer): void {
    const sink = this.frameSink;
    if (!sink) return;
    // Drop the newest frame once the queue exceeds its latency budget, so input lag
    // can't run away when the encode/send path falls below realtime. See
    // shouldDropFrame / MAX_SINK_BUFFER_BYTES.
    if (shouldDropFrame(sink.writableLength)) {
      streamFramesDroppedTotal.inc();
      if (this.session) this.session.framesDropped++;
      sinkBufferBytes.set(sink.writableLength);
      return;
    }
    const pushAt = performance.now();
    if (this.lastPushAt !== undefined) {
      streamFrameIntervalMs.observe(pushAt - this.lastPushAt);
    }
    this.lastPushAt = pushAt;
    sink.write(frame);
    // A slow write is backpressure showing up before the buffer gauge moves.
    streamFrameWriteMs.observe(performance.now() - pushAt);
    if (this.session) this.session.framesPushed++;
    // Rising buffered bytes ⇒ ffmpeg/encode can't keep up with the frame rate.
    sinkBufferBytes.set(sink.writableLength);
  }

  /** Feed resampled PCM (s16le/44.1 kHz/stereo) to the broadcast (no-op when idle). */
  pushAudio(pcm: Buffer): void {
    if (this.audioTransport !== null) this.audioTransport.sink.write(pcm);
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
    this.teardownAudio();
    // discord.js-selfbot-v13's client.destroy() dereferences `this.connection`
    // on each shard, which is null when the gateway never fully connected (or was
    // already torn down) — it throws "null is not an object (this.connection.
    // readyState)". Left unguarded that abort propagates out of session teardown
    // (`safeDriverStop`), so the userbot/voice/ffmpeg handles for the just-ended
    // /play session are never released and pile up across sessions. Swallow it:
    // destroy() is best-effort cleanup and there's nothing to recover here.
    try {
      this.streamer.client.destroy();
    } catch (error) {
      logger.warn("selfbot client destroy failed (ignored)", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
          this.resetStreamMetrics();
          const hadSession = this.session !== undefined;
          this.logSessionSummary();
          logger.info("Go-Live stream stopped");
          await notifyStreamSessionEnded(
            hadSession,
            this.options.onSessionEnded,
          );
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

    // Stand up the loopback audio transport before ffmpeg launches so its client
    // connect succeeds immediately. pushAudio writes into the transport sink; the
    // (only) connection pipes it to ffmpeg's audio input.
    const audioTransport = await createAudioTransport();
    this.audioTransport = audioTransport;

    const { output, promise } = prepareStream(bgra, {
      observer,
      width: content.width,
      height: content.height,
      pad: canvas,
      frameRate: this.options.frameRate,
      videoCodec: "H264",
      bitrateVideo: this.options.bitrateKbps,
      bitrateVideoMax: this.options.bitrateMaxKbps,
      includeAudio: true,
      // Game audio arrives out-of-band as raw PCM (the emulator emits frames and
      // samples on separate paths), so it can't ride the rawvideo input — ffmpeg
      // reads it from the loopback socket and muxes it into the broadcast.
      audioInput: {
        source: audioTransport.source,
        inputOptions: audioTransport.inputOptions,
      },
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
    const totalFrames = session.framesPushed + session.framesDropped;
    logger.info("stream session summary", {
      durationS: Math.round(durationS),
      framesPushed: session.framesPushed,
      framesDropped: session.framesDropped,
      droppedPct:
        totalFrames > 0
          ? Math.round((session.framesDropped / totalFrames) * 1000) / 10
          : 0,
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
