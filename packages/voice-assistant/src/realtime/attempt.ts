import { trace, type Attributes, type Span } from "@opentelemetry/api";

/**
 * The observation seam for one wake attempt. The pipeline reports evidence through this handle;
 * what happens to it — S3 capture, root spans, structured logs — is entirely the consumer's
 * concern (streambot's `ObservedVoiceAttempt` is one implementation). Only the handle types and
 * the noop observer live here.
 */

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

// The tracer/span names are deliberately unchanged from the pre-extraction streambot values:
// noop stages still start real spans through the global tracer provider, so renaming them here
// would alter exported span metadata for existing consumers.
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
