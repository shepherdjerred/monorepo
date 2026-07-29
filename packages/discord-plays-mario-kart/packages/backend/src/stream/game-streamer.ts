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
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  WIDTH,
  HEIGHT,
  N64_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import { createAudioTransport } from "#src/stream/audio-transport.ts";
import { sinkBufferBytes } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
  streamEmulatorBackpressurePausesTotal,
  streamEmulatorPaused,
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
  onEncoderBackpressureChange: (backpressured: boolean) => void;
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

// High-water mark for the PassThrough feeding ffmpeg. The emulator produces
// video and audio from the same tick loop, so pausing that loop when this queue
// fills preserves A/V content time while preventing the multi-gigabyte backlog
// observed before the stream was bounded. Three frames are about 100 ms at 30fps.
export const MAX_SINK_BUFFER_BYTES = WIDTH * HEIGHT * 4 * 3;
export const MIN_AUDIO_PREROLL_BYTES =
  AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * Int16Array.BYTES_PER_ELEMENT;

export type EncoderFlowAction = "pause" | "resume" | undefined;
export type EncoderFlowDecision = {
  action: EncoderFlowAction;
  watchDrain: boolean;
};

export class EncoderFlowControl {
  private audioPrerollBytes = 0;
  private backpressureArmed = true;
  private startupBypassApplied = false;
  private waitingForDrain = false;
  private paused = false;

  onAudio(bytes: number): void {
    this.audioPrerollBytes = Math.min(
      MIN_AUDIO_PREROLL_BYTES,
      this.audioPrerollBytes + bytes,
    );
  }

  onVideoWrite(canContinue: boolean): EncoderFlowDecision {
    if (canContinue) {
      return { action: undefined, watchDrain: false };
    }
    const watchDrain = !this.waitingForDrain;
    this.waitingForDrain = true;
    if (
      this.paused ||
      !this.backpressureArmed ||
      this.audioPrerollBytes < MIN_AUDIO_PREROLL_BYTES
    ) {
      return { action: undefined, watchDrain };
    }
    this.paused = true;
    this.backpressureArmed = false;
    return { action: "pause", watchDrain };
  }

  onProgress(): EncoderFlowAction {
    if (this.startupBypassApplied || !this.waitingForDrain) return undefined;
    this.startupBypassApplied = true;
    this.backpressureArmed = false;
    if (!this.paused) return undefined;
    this.paused = false;
    return "resume";
  }

  onDrain(): EncoderFlowAction {
    this.waitingForDrain = false;
    this.backpressureArmed = true;
    if (!this.paused) return undefined;
    this.paused = false;
    return "resume";
  }

  reset(): EncoderFlowAction {
    const action = this.paused ? "resume" : undefined;
    this.audioPrerollBytes = 0;
    this.backpressureArmed = true;
    this.startupBypassApplied = false;
    this.waitingForDrain = false;
    this.paused = false;
    return action;
  }
}

/**
 * Frame sink with a meaningful write() backpressure signal at the latency
 * budget. Node's default high-water mark is smaller than one raw frame, which
 * made write() return false for every frame and could not drive flow control.
 */
export function createFrameSink(): PassThrough {
  return new PassThrough({ highWaterMark: MAX_SINK_BUFFER_BYTES });
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
  private frameInput: PassThrough | undefined;
  private encoderBackpressured = false;
  private readonly encoderFlowControl = new EncoderFlowControl();
  private readonly handleFrameSinkDrain = (): void => {
    this.applyEncoderFlowAction(this.encoderFlowControl.onDrain());
  };

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
    const pushAt = performance.now();
    if (this.lastPushAt !== undefined) {
      streamFrameIntervalMs.observe(pushAt - this.lastPushAt);
    }
    this.lastPushAt = pushAt;
    const canContinue = sink.write(frame);
    // A slow write is backpressure showing up before the buffer gauge moves.
    streamFrameWriteMs.observe(performance.now() - pushAt);
    if (this.session) this.session.framesPushed++;
    sinkBufferBytes.set(sink.writableLength);
    const decision = this.encoderFlowControl.onVideoWrite(canContinue);
    if (decision.watchDrain) {
      sink.once("drain", this.handleFrameSinkDrain);
    }
    this.applyEncoderFlowAction(decision.action);
  }

  override pushAudio(pcm: Buffer): void {
    this.encoderFlowControl.onAudio(pcm.length);
    super.pushAudio(pcm);
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
    const bgra = createFrameSink();
    this.frameInput = bgra;
    // Scale the 4:3 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    const session = newSessionStats();
    const observer = createStreamObserver(session);
    const observeProgress = observer.onProgress;
    observer.onProgress = (progress) => {
      observeProgress?.(progress);
      this.applyEncoderFlowAction(this.encoderFlowControl.onProgress());
    };
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
        // Raw BGRA is fully described above; the minimum legal probe size
        // prevents ffmpeg waiting on a live pipe before it begins encoding.
        "-probesize",
        "32",
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
    this.frameInput?.off("drain", this.handleFrameSinkDrain);
    this.frameInput = undefined;
    this.applyEncoderFlowAction(this.encoderFlowControl.reset());
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
      encoderBackpressurePauses: session.encoderBackpressurePauses,
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

  private setEncoderBackpressured(backpressured: boolean): void {
    if (this.encoderBackpressured === backpressured) return;
    this.options.onEncoderBackpressureChange(backpressured);
    this.encoderBackpressured = backpressured;
    streamEmulatorPaused.set(backpressured ? 1 : 0);
    if (backpressured) {
      streamEmulatorBackpressurePausesTotal.inc();
      if (this.session) this.session.encoderBackpressurePauses++;
    }
  }

  private applyEncoderFlowAction(action: EncoderFlowAction): void {
    if (action === undefined) return;
    this.setEncoderBackpressured(action === "pause");
  }
}
