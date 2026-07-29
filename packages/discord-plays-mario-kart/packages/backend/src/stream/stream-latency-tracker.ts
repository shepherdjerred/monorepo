import type {
  PacketReadyStats,
  SendStats,
} from "@shepherdjerred/discord-video-stream";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "#src/emulator/constants.ts";

export type VideoSourceTiming = {
  contentTimeMs: number;
  availableAtMs: number;
  inputReceivedAtMs?: number;
};

export type AudioSourceTiming = {
  pcmBytes: number;
  contentEndMs: number;
  availableAtMs: number;
};

export type StreamLatencyObservations = {
  observePacketReady: (kind: "video" | "audio", delayMs: number) => void;
  observeSendComplete: (kind: "video" | "audio", delayMs: number) => void;
  observeInputToPacketReady: (delayMs: number) => void;
  observeInputToSendComplete: (delayMs: number) => void;
  observeAvContentOffset: (offsetMs: number) => void;
  correlationFailure: (
    kind: "video" | "audio",
    reason: "missing_source" | "missing_send" | "pts_mismatch",
  ) => void;
};

type AudioSpan = {
  startContentMs: number;
  endContentMs: number;
  availableAtMs: number;
};

type SourceCorrelation = {
  availableAtMs: number;
  contentOffsetMs: number;
  inputReceivedAtMs?: number;
};

type PendingSend = {
  ptsMs: number;
  source: SourceCorrelation | undefined;
};

const BYTES_PER_AUDIO_SAMPLE = 2;
const PTS_MATCH_EPSILON_MS = 0.01;
const DURATION_EPSILON_MS = 0.001;

/**
 * Correlates MK64 source media with the encoded NUT packets and paced RTP sends.
 *
 * Raw video frames remain one packet each because the production encoder has no
 * B-frames. Audio is matched by consuming the same amount of source PCM time as
 * each Opus packet covers. The content-offset comparison catches the failure
 * mode packet PTS alone cannot: video-only drops advance video source content
 * relative to its compressed output timeline while continuous audio does not.
 */
export class StreamLatencyTracker {
  private readonly observations: StreamLatencyObservations;
  private readonly now: () => number;
  private readonly videoSources: VideoSourceTiming[] = [];
  private readonly audioSources: AudioSpan[] = [];
  private readonly videoSends: PendingSend[] = [];
  private readonly audioSends: PendingSend[] = [];
  private pendingVideoInputReceivedAtMs: number | undefined;
  private videoContentOffsetMs: number | undefined;
  private audioContentOffsetMs: number | undefined;

  constructor(
    observations: StreamLatencyObservations,
    now: () => number = () => performance.timeOrigin + performance.now(),
  ) {
    this.observations = observations;
    this.now = now;
  }

  recordVideoSource(timing: VideoSourceTiming): void {
    const inputReceivedAtMs = this.earliestInputReceivedAt(
      timing.inputReceivedAtMs,
    );
    this.pendingVideoInputReceivedAtMs = undefined;
    this.videoSources.push({
      contentTimeMs: timing.contentTimeMs,
      availableAtMs: timing.availableAtMs,
      ...(inputReceivedAtMs === undefined ? {} : { inputReceivedAtMs }),
    });
  }

  recordDroppedVideoSource(timing: VideoSourceTiming | undefined): void {
    if (timing?.inputReceivedAtMs === undefined) return;
    this.pendingVideoInputReceivedAtMs = this.earliestInputReceivedAt(
      timing.inputReceivedAtMs,
    );
  }

  recordAudioSource(timing: AudioSourceTiming): void {
    const durationMs =
      (timing.pcmBytes /
        (AUDIO_CHANNELS * BYTES_PER_AUDIO_SAMPLE * AUDIO_SAMPLE_RATE)) *
      1000;
    if (durationMs <= 0) return;
    this.audioSources.push({
      startContentMs: timing.contentEndMs - durationMs,
      endContentMs: timing.contentEndMs,
      availableAtMs: timing.availableAtMs,
    });
  }

  onPacketReady(packet: PacketReadyStats): void {
    const observedAtMs = this.now();
    const source =
      packet.kind === "video"
        ? this.consumeVideoSource(packet, observedAtMs)
        : this.consumeAudioSource(packet, observedAtMs);
    const pending = { ptsMs: packet.ptsMs, source };
    if (packet.kind === "video") this.videoSends.push(pending);
    else this.audioSends.push(pending);
  }

  onSendStats(stats: SendStats): void {
    const queue = stats.kind === "video" ? this.videoSends : this.audioSends;
    const pending = queue.shift();
    if (pending === undefined) {
      this.observations.correlationFailure(stats.kind, "missing_send");
      return;
    }
    if (Math.abs(pending.ptsMs - stats.ptsMs) > PTS_MATCH_EPSILON_MS) {
      this.observations.correlationFailure(stats.kind, "pts_mismatch");
      return;
    }
    const source = pending.source;
    if (source === undefined) return;
    const observedAtMs = this.now();
    this.observations.observeSendComplete(
      stats.kind,
      observedAtMs - source.availableAtMs,
    );
    if (stats.kind === "video" && source.inputReceivedAtMs !== undefined) {
      this.observations.observeInputToSendComplete(
        observedAtMs - source.inputReceivedAtMs,
      );
    }
  }

  private consumeVideoSource(
    packet: PacketReadyStats,
    observedAtMs: number,
  ): SourceCorrelation | undefined {
    const source = this.videoSources.shift();
    if (source === undefined) {
      this.observations.correlationFailure("video", "missing_source");
      return undefined;
    }
    this.observations.observePacketReady(
      "video",
      observedAtMs - source.availableAtMs,
    );
    if (source.inputReceivedAtMs !== undefined) {
      this.observations.observeInputToPacketReady(
        observedAtMs - source.inputReceivedAtMs,
      );
    }
    const contentOffsetMs = source.contentTimeMs - packet.ptsMs;
    this.videoContentOffsetMs = contentOffsetMs;
    this.observeAvOffset();
    return {
      availableAtMs: source.availableAtMs,
      contentOffsetMs,
      ...(source.inputReceivedAtMs === undefined
        ? {}
        : { inputReceivedAtMs: source.inputReceivedAtMs }),
    };
  }

  private consumeAudioSource(
    packet: PacketReadyStats,
    observedAtMs: number,
  ): SourceCorrelation | undefined {
    const consumed = this.consumeAudioDuration(packet.durationMs);
    if (consumed === undefined) {
      this.observations.correlationFailure("audio", "missing_source");
      return undefined;
    }
    this.observations.observePacketReady(
      "audio",
      observedAtMs - consumed.availableAtMs,
    );
    const contentOffsetMs = consumed.startContentMs - packet.ptsMs;
    this.audioContentOffsetMs = contentOffsetMs;
    this.observeAvOffset();
    return {
      availableAtMs: consumed.availableAtMs,
      contentOffsetMs,
    };
  }

  private consumeAudioDuration(
    durationMs: number,
  ): { startContentMs: number; availableAtMs: number } | undefined {
    if (durationMs <= 0) return undefined;
    let availableDurationMs = 0;
    for (const span of this.audioSources) {
      availableDurationMs += span.endContentMs - span.startContentMs;
      if (availableDurationMs + DURATION_EPSILON_MS >= durationMs) break;
    }
    if (availableDurationMs + DURATION_EPSILON_MS < durationMs) {
      return undefined;
    }

    const first = this.audioSources[0];
    if (first === undefined) return undefined;
    const startContentMs = first.startContentMs;
    let availableAtMs = first.availableAtMs;
    let remainingMs = durationMs;
    while (remainingMs > DURATION_EPSILON_MS) {
      const span = this.audioSources[0];
      if (span === undefined) {
        throw new Error("audio source duration changed during consumption");
      }
      const spanDurationMs = span.endContentMs - span.startContentMs;
      const consumedMs = Math.min(remainingMs, spanDurationMs);
      availableAtMs = Math.max(availableAtMs, span.availableAtMs);
      span.startContentMs += consumedMs;
      remainingMs -= consumedMs;
      if (span.endContentMs - span.startContentMs <= DURATION_EPSILON_MS) {
        this.audioSources.shift();
      }
    }
    return { startContentMs, availableAtMs };
  }

  private observeAvOffset(): void {
    if (
      this.videoContentOffsetMs === undefined ||
      this.audioContentOffsetMs === undefined
    ) {
      return;
    }
    this.observations.observeAvContentOffset(
      this.videoContentOffsetMs - this.audioContentOffsetMs,
    );
  }

  private earliestInputReceivedAt(
    inputReceivedAtMs: number | undefined,
  ): number | undefined {
    if (inputReceivedAtMs === undefined) {
      return this.pendingVideoInputReceivedAtMs;
    }
    if (this.pendingVideoInputReceivedAtMs === undefined) {
      return inputReceivedAtMs;
    }
    return Math.min(inputReceivedAtMs, this.pendingVideoInputReceivedAtMs);
  }
}
