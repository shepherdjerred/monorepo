/**
 * Injected ports. This package owns the voice pipeline's mechanics but none of its operational
 * surface: logging, metric series, trace-name prefixes, the assistant audio transport, and duck
 * observation are all supplied by the consumer. That is what lets two bots share the pipeline
 * while keeping their existing metric series and trace names byte-identical.
 */

export type VoiceLogger = {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Counter port. Unlabeled by default; pass a label object type for labeled series. */
export type CounterPort<L = never> = [L] extends [never]
  ? { readonly inc: (value?: number) => void }
  : { readonly inc: (labels: L, value?: number) => void };

/** Histogram port. Unlabeled by default; pass a label object type for labeled series. */
export type HistogramPort<L = never> = [L] extends [never]
  ? { readonly observe: (value: number) => void }
  : { readonly observe: (labels: L, value: number) => void };

export type GaugePort = {
  readonly inc: () => void;
  readonly dec: () => void;
};

/**
 * Logger plus the OTel span/attribute name prefix. Every span or attribute this package records
 * is `${stagePrefix}.<fixed suffix>`, so a consumer that passes its historical prefix (streambot
 * passes "streambot.voice") keeps its traces byte-identical across the extraction.
 */
export type VoiceObservability = {
  readonly logger: VoiceLogger;
  readonly stagePrefix: string;
};

/** Where paced assistant reply audio goes: a live voice connection owned by the consumer. */
export type AssistantAudioTransport = {
  readonly setAssistantSpeaking: (speaking: boolean) => Promise<void>;
  readonly sendAssistantOpus: (opus: Uint8Array) => void;
};

/** Observes playback ducking around assistant speech; consumers map it to session telemetry. */
export type DuckObserver = {
  readonly duckChanged: (ducked: boolean, outcome?: string) => void;
};

/** Metrics recorded by {@link VoiceAudioLifecycle} itself. */
export type VoiceLifecycleMetrics = {
  readonly turnDeliveryFailures: CounterPort;
};

/** Metrics recorded by one Realtime command turn. */
export type RealtimeTurnMetrics = {
  readonly audioTokens: CounterPort<{
    readonly direction: "input" | "output";
  }>;
  readonly activationStageLatencySeconds: HistogramPort<{
    readonly stage: string;
  }>;
  readonly concurrentTurns: GaugePort;
  readonly openAiFailures: CounterPort<{ readonly stage: string }>;
  readonly replySendFailures: CounterPort;
  readonly transcriptVerifications: CounterPort<{ readonly outcome: string }>;
  readonly transcriptionUsage: CounterPort<{
    readonly unit: "tokens" | "seconds";
    readonly direction: "input" | "output";
  }>;
  readonly turns: CounterPort<{ readonly outcome: string }>;
  readonly wakeToReplySeconds: HistogramPort;
  readonly cloudRequests: CounterPort<{
    readonly stage: string;
    readonly outcome: string;
  }>;
};

/** Metrics recorded by the paced assistant reply sender. */
export type ReplyMetrics = {
  readonly replyPackets: CounterPort;
  readonly replyBytes: CounterPort;
  readonly replySendFailures: CounterPort;
  readonly replyDurationSeconds: HistogramPort<{ readonly outcome: string }>;
};

export type VoiceMetrics = {
  readonly lifecycle: VoiceLifecycleMetrics;
  readonly realtimeTurn: RealtimeTurnMetrics;
  readonly reply: ReplyMetrics;
};

function noop(): void {
  /* deliberate no-op sink */
}

export const NOOP_VOICE_LOGGER: VoiceLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/** All-noop metric ports for probes and tests that measure behavior, not series. */
export function createNoopVoiceMetrics(): VoiceMetrics {
  const counter = { inc: noop };
  const histogram = { observe: noop };
  return {
    lifecycle: { turnDeliveryFailures: counter },
    realtimeTurn: {
      audioTokens: counter,
      activationStageLatencySeconds: histogram,
      concurrentTurns: { inc: noop, dec: noop },
      openAiFailures: counter,
      replySendFailures: counter,
      transcriptVerifications: counter,
      transcriptionUsage: counter,
      turns: counter,
      wakeToReplySeconds: histogram,
      cloudRequests: counter,
    },
    reply: {
      replyPackets: counter,
      replyBytes: counter,
      replySendFailures: counter,
      replyDurationSeconds: histogram,
    },
  };
}
