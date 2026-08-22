import { Counter, Gauge, Registry } from "prom-client";
import {
  FEATURE_FLAG_METRICS,
  type FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

export const registry = new Registry();

const featureFlagEvaluationsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.evaluations,
  help: "Feature flag evaluations by flag and resolution reason",
  labelNames: ["flag", "reason"] as const,
  registers: [registry],
});

const featureFlagErrorsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.errors,
  help: "Feature flag provider errors by operation",
  labelNames: ["operation"] as const,
  registers: [registry],
});

const featureFlagSnapshotAgeSeconds = new Gauge({
  name: FEATURE_FLAG_METRICS.snapshotAge,
  help: "Seconds since the feature flag snapshot refreshed successfully",
  registers: [registry],
});

export const featureFlagMetrics: FlagMetricsRecorder = {
  countEvaluation: (event) => {
    featureFlagEvaluationsTotal.inc({
      flag: event.flag,
      reason: event.reason,
    });
  },
  countError: (operation) => {
    featureFlagErrorsTotal.inc({ operation });
  },
  observeSnapshotAge: (seconds) => {
    featureFlagSnapshotAgeSeconds.set(seconds);
  },
};
