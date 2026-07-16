import { PassThrough } from "node:stream";
import type { Client } from "discord.js-selfbot-v13";
import {
  prepareStream,
  Encoders,
  computeLetterbox,
  type PlayStreamOptions,
  type StreamObserver,
} from "@shepherdjerred/discord-video-stream";
import type { EncoderHandles } from "@shepherdjerred/discord-stream-lifecycle/types.ts";
import { GameStreamerBase } from "@shepherdjerred/discord-plays-core/stream/game-streamer-base.ts";
import {
  WIDTH,
  HEIGHT,
  N64_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import { createAudioTransport } from "#src/stream/audio-transport.ts";
import { sinkBufferBytes } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
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
// broadcast. The lifecycle (join voice → encode → broadcast → leave) is owned by
// the shared GameStreamerBase; this subclass supplies Mario Kart-specific side
// effects (BGRA input, s16le audio, the bounded frame queue) and preserves the
// richer ffmpeg/session metrics.
export class GameStreamer extends GameStreamerBase {
  private readonly options: GameStreamerOptions;
  private session: SessionStats | undefined;
  private sessionStartedAt = 0;
  private lastPushAt: number | undefined;
  private streamObserver: StreamObserver | undefined;

  constructor(options: GameStreamerOptions) {
    super({
      selfbotClient: options.selfbotClient,
      guildId: options.guildId,
      channelId: options.channelId,
      logger,
    });
    this.options = options;
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

  protected override beforeActorStop(): void {
    this.sendToActor({ type: "SHUTDOWN" });
  }

  protected override destroyClient(): void {
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

  protected async buildEncoder(): Promise<EncoderHandles> {
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

  protected override async afterLeaveVoice(): Promise<void> {
    this.resetStreamMetrics();
    const hadSession = this.session !== undefined;
    this.logSessionSummary();
    logger.info("Go-Live stream stopped");
    await notifyStreamSessionEnded(hadSession, this.options.onSessionEnded);
  }

  protected override playOptions(): Partial<PlayStreamOptions> {
    if (this.streamObserver) {
      return { type: "go-live", observer: this.streamObserver };
    }
    return { type: "go-live" };
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
}
