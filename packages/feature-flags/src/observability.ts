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
  snapshotAge: "feature_flag_snapshot_age_seconds",
} as const;

/**
 * `flag` and `reason` are bounded by the declared config surface and the
 * OpenFeature reason vocabulary. **`targetingKey` is never a label** — it is a
 * guild or user id, so it would be unbounded.
 */
export const FEATURE_FLAG_METRIC_LABELS = {
  evaluations: ["flag", "reason"],
  errors: ["operation"],
  snapshotAge: [],
} as const;

export type FlagOperation = "initialize" | "refresh" | "evaluate" | "shutdown";

export type EvaluationEvent = {
  readonly flag: string;
  readonly reason: FlagReason;
  readonly errorCode: FlagErrorCode | undefined;
};

export type FlagMetricsRecorder = {
  readonly countEvaluation: (event: EvaluationEvent) => void;
  readonly countError: (operation: FlagOperation) => void;
  /**
   * Seconds since the snapshot last refreshed successfully.
   *
   * This is the signal that a flag backend is unreachable — deliberately, in
   * place of per-evaluation logging or Sentry reporting. During an outage the
   * provider keeps serving its last good snapshot, so evaluations still succeed;
   * a rising snapshot age is what tells an operator the values are frozen.
   * Reporting each evaluation instead would emit one Bugsink event per flag
   * read and drown the actual signal.
   */
  readonly observeSnapshotAge: (seconds: number) => void;
};
