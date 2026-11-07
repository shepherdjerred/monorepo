import type {
  FlagErrorCode,
  FlagReason,
} from "@shepherdjerred/feature-flags/flag-result.ts";

/**
 * Instrumentation for the flag client.
 *
 * Like `@shepherdjerred/config`, this package owns no metrics client: a
 * Prometheus registry is per-process state, and a library that creates one
 * forces its choice on every consumer. Shared here is the **naming**, so three
 * services cannot instrument the same thing three different ways.
 */

export const FEATURE_FLAG_METRICS = {
  evaluations: "feature_flag_evaluations_total",
  errors: "feature_flag_errors_total",
  providerReady: "feature_flag_provider_ready",
  snapshotAge: "feature_flag_snapshot_age_seconds",
  providerInfo: "feature_flag_provider_info",
} as const;

/**
 * `flag` and `reason` are bounded by the declared config surface and the
 * OpenFeature reason vocabulary. **`targetingKey` is never a label** — it is a
 * guild or user id, so it would be unbounded.
 */
export const FEATURE_FLAG_METRIC_LABELS = {
  evaluations: ["flag", "reason", "value"],
  errors: ["operation"],
  providerReady: [],
  snapshotAge: [],
  providerInfo: ["flipt_environment", "flipt_namespace"],
} as const;

export type FlagOperation = "initialize" | "refresh" | "evaluate" | "shutdown";

export type FlagEvaluationValue = "true" | "false" | "non_boolean" | "error";
export type FlagProviderInfo = {
  readonly flipt_environment: string;
  readonly flipt_namespace: string;
};

export type EvaluationEvent = {
  readonly flag: string;
  readonly reason: FlagReason;
  readonly errorCode: FlagErrorCode | undefined;
  readonly value: FlagEvaluationValue;
};

export type FlagMetricsRecorder = {
  readonly countEvaluation: (event: EvaluationEvent) => void;
  readonly countError: (operation: FlagOperation) => void;
  /** Whether the named OpenFeature provider is currently ready to evaluate. */
  readonly observeProviderReady: (ready: boolean) => void;
  /**
   * Seconds since the snapshot last refreshed successfully.
   *
   * This is the signal that a flag backend is unreachable — deliberately, in
   * place of per-evaluation logging or Bugsink reporting. During an outage the
   * provider keeps serving its last good snapshot, so evaluations still succeed;
   * a rising snapshot age is what tells an operator the values are frozen.
   * Reporting each evaluation instead would emit one Bugsink event per flag
   * read and drown the actual signal.
   */
  readonly observeSnapshotAge: (seconds: number) => void;
  readonly observeProviderInfo: (info: FlagProviderInfo | undefined) => void;
};

type CounterMetric<Labels> = {
  readonly inc: (labels: Labels) => void;
};

type GaugeMetric = {
  readonly set: (value: number) => void;
};

/** Adapts process-owned Prometheus metrics to the shared lifecycle contract. */
export function createFlagMetricsRecorder(input: {
  readonly evaluations: CounterMetric<{
    readonly flag: string;
    readonly reason: FlagReason;
    readonly value: FlagEvaluationValue;
  }>;
  readonly errors: CounterMetric<{ readonly operation: FlagOperation }>;
  readonly providerReady: GaugeMetric;
  readonly snapshotAge: GaugeMetric;
  readonly providerInfo: {
    readonly reset: () => void;
    readonly set: (labels: FlagProviderInfo, value: number) => void;
  };
}): FlagMetricsRecorder {
  return {
    countEvaluation: (event) => {
      input.evaluations.inc({
        flag: event.flag,
        reason: event.reason,
        value: event.value,
      });
    },
    countError: (operation) => {
      input.errors.inc({ operation });
    },
    observeProviderReady: (ready) => {
      input.providerReady.set(ready ? 1 : 0);
    },
    observeSnapshotAge: (seconds) => {
      input.snapshotAge.set(seconds);
    },
    observeProviderInfo: (info) => {
      input.providerInfo.reset();
      if (info !== undefined) input.providerInfo.set(info, 1);
    },
  };
}
