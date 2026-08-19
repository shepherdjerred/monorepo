import {
  context,
  isSpanContextValid,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import {
  getTracer,
  markSpanError,
} from "@shepherdjerred/streambot/observability/tracing.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  VoiceCaptureManifestSchema,
  type VoiceCaptureAudioObject,
  type VoiceCaptureManifest,
} from "@shepherdjerred/streambot/voice/capture-manifest.ts";
import type { VoiceCaptureUploadQueue } from "@shepherdjerred/streambot/voice/capture-store.ts";
import { encodePcm16MonoWave } from "@shepherdjerred/streambot/voice/wave-io.ts";

const log = logger.child("voice-attempt");
const SAMPLE_RATE = 16_000;

export type VoiceAttemptCandidate = {
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly detector: "sherpa";
  readonly phrase: string;
  readonly score: number | null;
  readonly fragmentEndSeconds: number | null;
  readonly detectedAtMs: number;
};

export type VoiceAttemptEndpoint = {
  readonly reason: string;
  readonly sawSpeech: boolean;
  readonly sampleCount: number;
  readonly dtxSamples: number;
  readonly pcm16k: Float32Array;
};

export type VoiceToolObservation = {
  readonly name: string;
  readonly arguments: unknown;
  readonly result?: string;
  readonly outcome: string;
  readonly durationMs: number;
};

export type VoiceAttemptHandle = {
  readonly captureId: string;
  readonly traceId: string | undefined;
  readonly run: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly runStage: <T>(
    name: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>,
  ) => Promise<T>;
  readonly recordStage: (
    name: string,
    durationMs: number,
    attributes: Attributes,
    error?: unknown,
  ) => void;
  readonly localVerification: (evidence: {
    readonly accepted: boolean;
    readonly score: number;
    readonly latencyMs: number;
  }) => void;
  readonly endpoint: (evidence: VoiceAttemptEndpoint) => void;
  readonly transcription: (input: {
    readonly transcript: string;
    readonly normalizedCommand: string | null;
    readonly outcome: string;
  }) => void;
  readonly tool: (observation: VoiceToolObservation) => void;
  readonly cloudOutcome: (outcome: string) => void;
  readonly cloudUsage: (usage: unknown) => void;
  readonly reply: (input: {
    readonly outcome: string;
    readonly packets: number;
    readonly bytes: number;
    readonly durationMs: number;
  }) => void;
  readonly finish: (outcome: string, error?: unknown) => void;
};

const noopAttempt: VoiceAttemptHandle = {
  captureId: "offline-no-capture",
  traceId: undefined,
  run: async (fn) => await fn(),
  runStage: async (_name, _attributes, fn) => {
    const span = trace.getTracer("streambot-noop").startSpan("noop");
    try {
      return await fn(span);
    } finally {
      span.end();
    }
  },
  recordStage: () => null,
  localVerification: () => null,
  endpoint: () => null,
  transcription: () => null,
  tool: () => null,
  cloudOutcome: () => null,
  cloudUsage: () => null,
  reply: () => null,
  finish: () => null,
};

export const NOOP_VOICE_ATTEMPT_OBSERVER = {
  begin: (): VoiceAttemptHandle => noopAttempt,
};

export type VoiceAttemptObserver = {
  readonly begin: (candidate: VoiceAttemptCandidate) => VoiceAttemptHandle;
};

type ManifestState = {
  verifierAccepted?: boolean;
  verifierScore?: number;
  verifierLatencyMs?: number;
  endpoint?: VoiceCaptureManifest["endpoint"];
  audio?: { bytes: Uint8Array; metadata: VoiceCaptureAudioObject };
  transcript?: string | null;
  normalizedCommand?: string | null;
  tools: VoiceCaptureManifest["tools"];
  cloudOutcome?: string;
  cloudUsage?: unknown;
  reply?: VoiceCaptureManifest["reply"];
  errors: VoiceCaptureManifest["errors"];
};

export class ObservedVoiceAttempt implements VoiceAttemptHandle {
  readonly captureId = crypto.randomUUID();
  readonly traceId: string | undefined;
  private readonly rootSpan: Span;
  private readonly rootContext: Context;
  private readonly state: ManifestState = { tools: [], errors: [] };
  private finished = false;

  constructor(
    private readonly candidate: VoiceAttemptCandidate,
    private readonly uploads: VoiceCaptureUploadQueue,
  ) {
    this.rootSpan = getTracer().startSpan("streambot.voice.attempt", {
      attributes: {
        "streambot.capture_id": this.captureId,
        "discord.guild_id": candidate.guildId,
        "discord.channel_id": candidate.channelId,
        "discord.user_id": candidate.userId,
        "streambot.voice.wake_fragment": candidate.phrase,
        "streambot.voice.wake_score": candidate.score ?? -1,
      },
    });
    this.rootContext = trace.setSpan(context.active(), this.rootSpan);
    const spanContext = this.rootSpan.spanContext();
    this.traceId = isSpanContextValid(spanContext)
      ? spanContext.traceId
      : undefined;
    context.with(this.rootContext, () => {
      log.info("voice wake candidate started", {
        captureId: this.captureId,
        guildId: candidate.guildId,
        channelId: candidate.channelId,
        userId: candidate.userId,
        phrase: candidate.phrase,
        score: candidate.score,
      });
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return await context.with(this.rootContext, fn);
  }

  async runStage<T>(
    name: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return await context.with(this.rootContext, () =>
      getTracer().startActiveSpan(name, { attributes }, async (span) => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          markSpanError(span, error);
          this.recordError(name, error);
          throw error;
        } finally {
          span.end();
        }
      }),
    );
  }

  recordStage(
    name: string,
    durationMs: number,
    attributes: Attributes,
    error?: unknown,
  ): void {
    context.with(this.rootContext, () => {
      const endedAt = Date.now();
      const span = getTracer().startSpan(name, {
        attributes,
        startTime: endedAt - durationMs,
      });
      if (error === undefined) {
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        markSpanError(span, error);
        this.recordError(name, error);
        log.error("voice attempt stage failed", {
          captureId: this.captureId,
          stage: name,
          error: getErrorMessage(error),
        });
      }
      span.end(endedAt);
    });
  }

  localVerification(evidence: {
    readonly accepted: boolean;
    readonly score: number;
    readonly latencyMs: number;
  }): void {
    this.state.verifierAccepted = evidence.accepted;
    this.state.verifierScore = evidence.score;
    this.state.verifierLatencyMs = evidence.latencyMs;
    this.recordStage("streambot.voice.local_verification", evidence.latencyMs, {
      "streambot.voice.verifier.accepted": evidence.accepted,
      "streambot.voice.verifier.score": evidence.score,
    });
  }

  endpoint(evidence: VoiceAttemptEndpoint): void {
    const durationSeconds = evidence.sampleCount / SAMPLE_RATE;
    this.state.endpoint = {
      reason: evidence.reason,
      sawSpeech: evidence.sawSpeech,
      sampleCount: evidence.sampleCount,
      durationSeconds,
      dtxSeconds: evidence.dtxSamples / SAMPLE_RATE,
    };
    this.recordStage("streambot.voice.endpointing", 0, {
      "streambot.voice.endpoint.reason": evidence.reason,
      "streambot.voice.utterance_seconds": durationSeconds,
      "streambot.voice.dtx_seconds": evidence.dtxSamples / SAMPLE_RATE,
      "streambot.voice.saw_speech": evidence.sawSpeech,
    });
    if (!this.uploads.enabled) return;
    const bytes = encodePcm16MonoWave(evidence.pcm16k, SAMPLE_RATE);
    const key = `${this.prefix()}/speaker.wav`;
    this.state.audio = {
      bytes,
      metadata: {
        key,
        filename: "speaker.wav",
        userId: this.candidate.userId,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        encoding: "pcm_s16le",
        durationSeconds,
      },
    };
  }

  transcription(input: {
    readonly transcript: string;
    readonly normalizedCommand: string | null;
    readonly outcome: string;
  }): void {
    this.state.transcript = input.transcript;
    this.state.normalizedCommand = input.normalizedCommand;
    this.rootSpan.setAttributes({
      "streambot.voice.transcript": input.transcript,
      "streambot.voice.normalized_command": input.normalizedCommand ?? "",
      "streambot.voice.transcript_outcome": input.outcome,
    });
  }

  tool(observation: VoiceToolObservation): void {
    this.state.tools.push(observation);
    this.rootSpan.addEvent("streambot.voice.tool", {
      "streambot.voice.tool.name": observation.name,
      "streambot.voice.tool.arguments": JSON.stringify(observation.arguments),
      "streambot.voice.tool.result": observation.result ?? "",
      "streambot.voice.tool.outcome": observation.outcome,
      "streambot.voice.tool.duration_ms": observation.durationMs,
    });
  }

  cloudOutcome(outcome: string): void {
    this.state.cloudOutcome = outcome;
    this.rootSpan.setAttribute("streambot.voice.cloud_outcome", outcome);
  }

  cloudUsage(usage: unknown): void {
    this.state.cloudUsage = usage;
    this.rootSpan.addEvent("streambot.voice.cloud_usage", {
      "streambot.voice.cloud_usage": JSON.stringify(usage),
    });
  }

  reply(input: {
    readonly outcome: string;
    readonly packets: number;
    readonly bytes: number;
    readonly durationMs: number;
  }): void {
    this.state.reply = input;
    this.rootSpan.setAttributes({
      "streambot.voice.reply_outcome": input.outcome,
      "streambot.voice.reply_packets": input.packets,
      "streambot.voice.reply_bytes": input.bytes,
      "streambot.voice.reply_duration_ms": input.durationMs,
    });
  }

  finish(outcome: string, error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    if (error === undefined) {
      this.rootSpan.setStatus({ code: SpanStatusCode.OK });
    } else {
      markSpanError(this.rootSpan, error);
      this.recordError("attempt", error);
    }
    this.rootSpan.setAttribute("streambot.voice.outcome", outcome);
    const endedAtMs = Date.now();
    this.enqueueManifest(outcome, endedAtMs);
    context.with(this.rootContext, () => {
      log.info("voice attempt finished", {
        captureId: this.captureId,
        outcome,
        durationMs: Math.max(0, endedAtMs - this.candidate.detectedAtMs),
      });
    });
    this.rootSpan.end();
  }

  private enqueueManifest(outcome: string, endedAtMs: number): void {
    if (!this.uploads.enabled) return;
    const audio = this.state.audio;
    if (audio === undefined) {
      log.error("voice attempt finished without capture audio", {
        captureId: this.captureId,
        outcome,
      });
      return;
    }
    const manifest = VoiceCaptureManifestSchema.parse({
      schemaVersion: 1,
      captureId: this.captureId,
      kind: "wake-candidate",
      committedAt: new Date(endedAtMs).toISOString(),
      startedAt: new Date(this.candidate.detectedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      guildId: this.candidate.guildId,
      channelId: this.candidate.channelId,
      userId: this.candidate.userId,
      traceId: this.traceId,
      terminalOutcome: outcome,
      truncated: false,
      audio: [audio.metadata],
      wake: {
        detector: this.candidate.detector,
        phrase: this.candidate.phrase,
        score: this.candidate.score,
        fragmentEndSeconds: this.candidate.fragmentEndSeconds,
        detectedAt: new Date(this.candidate.detectedAtMs).toISOString(),
        verifierAccepted: this.state.verifierAccepted,
        verifierScore: this.state.verifierScore,
        verifierLatencyMs: this.state.verifierLatencyMs,
      },
      endpoint: this.state.endpoint,
      transcript: this.state.transcript,
      normalizedCommand: this.state.normalizedCommand,
      tools: this.state.tools,
      cloudOutcome: this.state.cloudOutcome,
      cloudUsage: this.state.cloudUsage,
      reply: this.state.reply,
      errors: this.state.errors,
    });
    const accepted = this.uploads.enqueue({
      captureId: this.captureId,
      audio: [
        {
          key: audio.metadata.key,
          body: audio.bytes,
          contentType: "audio/wav",
        },
      ],
      manifestKey: `${this.prefix()}/manifest.json`,
      manifest,
    });
    if (!accepted) audio.bytes.fill(0);
  }

  private recordError(stage: string, error: unknown): void {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    this.state.errors.push({
      stage,
      class: normalized.name,
      message: normalized.message,
    });
  }

  private prefix(): string {
    const date = new Date(this.candidate.detectedAtMs);
    return `voice-captures/${String(date.getUTCFullYear()).padStart(4, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${this.captureId}`;
  }
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
