import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { voiceCaptureDropsTotal } from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  ObservedVoiceAttempt,
  type VoiceAttemptCandidate,
  type VoiceAttemptHandle,
  type VoiceAttemptObserver,
} from "@shepherdjerred/streambot/voice/attempt-context.ts";
import { VoiceCaptureManifestSchema } from "@shepherdjerred/streambot/voice/capture-manifest.ts";
import {
  createS3CaptureObjectStore,
  VoiceCaptureUploadQueue,
  type CaptureObject,
  type CaptureObjectStore,
} from "@shepherdjerred/streambot/voice/capture-store.ts";
import {
  encodePcm16MonoWaveBytes,
  encodePcm16Samples,
} from "@shepherdjerred/streambot/voice/wave-io.ts";

const log = logger.child("voice-capture-manager");
const SAMPLE_RATE = 16_000;
const MIN_DEBUG_SECONDS = 10;
const MAX_DEBUG_SECONDS = 300;
const MAX_DEBUG_SPEAKERS = 8;
const MAX_DEBUG_BYTES = 96 * 1024 * 1024;

export type VoiceSessionIdentity = {
  readonly guildId: string;
  readonly channelId: string;
};

export type VoiceDebugCaptureStatus = VoiceSessionIdentity & {
  readonly captureId: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly speakerCount: number;
  readonly bufferedBytes: number;
  readonly truncated: boolean;
};

export type VoiceDebugStartResult =
  | { readonly outcome: "started"; readonly status: VoiceDebugCaptureStatus }
  | { readonly outcome: "disabled" }
  | {
      readonly outcome: "already-active";
      readonly status: VoiceDebugCaptureStatus;
    };

export type VoiceDebugStopResult =
  | { readonly outcome: "stopped"; readonly status: VoiceDebugCaptureStatus }
  | { readonly outcome: "none" }
  | {
      readonly outcome: "different-session";
      readonly status: VoiceDebugCaptureStatus;
    };

type DebugSpeaker = {
  readonly index: number;
  readonly userId: string;
  readonly chunks: Uint8Array[];
  bytes: number;
};

type ActiveDebugCapture = VoiceSessionIdentity & {
  readonly captureId: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly speakers: Map<string, DebugSpeaker>;
  bufferedBytes: number;
  truncated: boolean;
  truncationReason?: string;
  timer: ReturnType<typeof setTimeout>;
};

/** Process-wide owner for wake captures, manual decoded-audio windows, and upload flushing. */
export class VoiceCaptureManager implements VoiceAttemptObserver {
  private readonly uploads: VoiceCaptureUploadQueue;
  private activeDebug: ActiveDebugCapture | null = null;

  constructor(
    capture: Config["voice"]["capture"],
    store: CaptureObjectStore | null = createS3CaptureObjectStore(capture),
  ) {
    this.uploads = new VoiceCaptureUploadQueue(store);
  }

  get enabled(): boolean {
    return this.uploads.enabled;
  }

  begin(candidate: VoiceAttemptCandidate): VoiceAttemptHandle {
    return new ObservedVoiceAttempt(candidate, this.uploads);
  }

  startDebug(
    session: VoiceSessionIdentity,
    durationSeconds: number,
  ): VoiceDebugStartResult {
    if (!this.enabled) return { outcome: "disabled" };
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_DEBUG_SECONDS ||
      durationSeconds > MAX_DEBUG_SECONDS
    ) {
      throw new Error(
        "Voice debug duration must be an integer from 10 to 300 seconds",
      );
    }
    if (this.activeDebug !== null) {
      return {
        outcome: "already-active",
        status: this.status(this.activeDebug),
      };
    }
    const startedAtMs = Date.now();
    const active: ActiveDebugCapture = {
      ...session,
      captureId: crypto.randomUUID(),
      startedAtMs,
      expiresAtMs: startedAtMs + durationSeconds * 1000,
      speakers: new Map(),
      bufferedBytes: 0,
      truncated: false,
      timer: setTimeout(() => {
        this.finalizeDebug(active, "duration-complete");
      }, durationSeconds * 1000),
    };
    this.activeDebug = active;
    log.info("voice debug capture started", {
      captureId: active.captureId,
      guildId: session.guildId,
      channelId: session.channelId,
      durationSeconds,
    });
    return { outcome: "started", status: this.status(active) };
  }

  stopDebug(session: VoiceSessionIdentity): VoiceDebugStopResult {
    const active = this.activeDebug;
    if (active === null) return { outcome: "none" };
    if (!this.owns(active, session)) {
      return { outcome: "different-session", status: this.status(active) };
    }
    const status = this.status(active);
    this.finalizeDebug(active, "operator-stop");
    return { outcome: "stopped", status };
  }

  debugStatus(session: VoiceSessionIdentity): VoiceDebugCaptureStatus | null {
    const active = this.activeDebug;
    return active !== null && this.owns(active, session)
      ? this.status(active)
      : null;
  }

  acceptDecoded(
    session: VoiceSessionIdentity,
    userId: string,
    samples: Float32Array,
  ): void {
    const active = this.activeDebug;
    if (active === null || !this.owns(active, session)) return;
    let speaker = active.speakers.get(userId);
    if (speaker === undefined) {
      if (active.speakers.size >= MAX_DEBUG_SPEAKERS) {
        active.truncated = true;
        active.truncationReason = "speaker-limit";
        voiceCaptureDropsTotal.inc({ reason: "debug-speaker-limit" });
        this.finalizeDebug(active, "truncated");
        return;
      }
      speaker = {
        index: active.speakers.size + 1,
        userId,
        chunks: [],
        bytes: 0,
      };
      active.speakers.set(userId, speaker);
    }
    const pcm = encodePcm16Samples(samples);
    const remaining = MAX_DEBUG_BYTES - active.bufferedBytes;
    if (pcm.byteLength > remaining) {
      const completeBytes = remaining - (remaining % 2);
      if (completeBytes > 0) {
        const bounded = pcm.slice(0, completeBytes);
        speaker.chunks.push(bounded);
        speaker.bytes += bounded.byteLength;
        active.bufferedBytes += bounded.byteLength;
      }
      pcm.fill(0);
      active.truncated = true;
      active.truncationReason = "buffer-limit";
      voiceCaptureDropsTotal.inc({ reason: "debug-buffer-limit" });
      this.finalizeDebug(active, "truncated");
      return;
    }
    speaker.chunks.push(pcm);
    speaker.bytes += pcm.byteLength;
    active.bufferedBytes += pcm.byteLength;
  }

  closeSession(session: VoiceSessionIdentity): void {
    const active = this.activeDebug;
    if (active !== null && this.owns(active, session)) {
      this.finalizeDebug(active, "session-closed");
    }
  }

  async shutdown(): Promise<void> {
    if (this.activeDebug !== null) {
      this.finalizeDebug(this.activeDebug, "shutdown");
    }
    await this.uploads.shutdown();
  }

  private finalizeDebug(active: ActiveDebugCapture, outcome: string): void {
    if (this.activeDebug !== active) return;
    this.activeDebug = null;
    clearTimeout(active.timer);
    const endedAtMs = Date.now();
    const audioObjects: CaptureObject[] = [];
    const audio = [];
    const speakerMappings = [];
    const prefix = capturePrefix(active.startedAtMs, active.captureId);
    for (const speaker of active.speakers.values()) {
      const filename = `speaker-${String(speaker.index).padStart(3, "0")}.wav`;
      const key = `${prefix}/${filename}`;
      const pcm = combineBytes(speaker.chunks, speaker.bytes);
      const wav = encodePcm16MonoWaveBytes(pcm, SAMPLE_RATE);
      pcm.fill(0);
      for (const chunk of speaker.chunks) chunk.fill(0);
      audioObjects.push({ key, body: wav, contentType: "audio/wav" });
      audio.push({
        key,
        filename,
        userId: speaker.userId,
        sha256: sha256(wav),
        bytes: wav.byteLength,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        encoding: "pcm_s16le",
        durationSeconds: speaker.bytes / 2 / SAMPLE_RATE,
      });
      speakerMappings.push({ filename, userId: speaker.userId });
    }
    const manifest = VoiceCaptureManifestSchema.parse({
      schemaVersion: 1,
      captureId: active.captureId,
      kind: "debug-window",
      committedAt: new Date(endedAtMs).toISOString(),
      startedAt: new Date(active.startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      guildId: active.guildId,
      channelId: active.channelId,
      terminalOutcome: outcome,
      truncated: active.truncated,
      truncationReason: active.truncationReason,
      audio,
      speakerMappings,
      tools: [],
      errors: [],
    });
    const accepted = this.uploads.enqueue({
      captureId: active.captureId,
      audio: audioObjects,
      manifestKey: `${prefix}/manifest.json`,
      manifest,
    });
    if (!accepted) {
      for (const object of audioObjects) object.body.fill(0);
    }
    log.info("voice debug capture finalized", {
      captureId: active.captureId,
      outcome,
      truncated: active.truncated,
      truncationReason: active.truncationReason,
      speakerCount: active.speakers.size,
      bufferedBytes: active.bufferedBytes,
    });
  }

  private owns(
    active: ActiveDebugCapture,
    session: VoiceSessionIdentity,
  ): boolean {
    return (
      active.guildId === session.guildId &&
      active.channelId === session.channelId
    );
  }

  private status(active: ActiveDebugCapture): VoiceDebugCaptureStatus {
    return {
      captureId: active.captureId,
      guildId: active.guildId,
      channelId: active.channelId,
      startedAtMs: active.startedAtMs,
      expiresAtMs: active.expiresAtMs,
      speakerCount: active.speakers.size,
      bufferedBytes: active.bufferedBytes,
      truncated: active.truncated,
    };
  }
}

function combineBytes(
  chunks: readonly Uint8Array[],
  length: number,
): Uint8Array {
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function capturePrefix(startedAtMs: number, captureId: string): string {
  const date = new Date(startedAtMs);
  return `voice-captures/${String(date.getUTCFullYear()).padStart(4, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${captureId}`;
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
