import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import {
  FEATURE_FLAG_METRICS,
  type FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

export const metricsRegister = new Registry();
metricsRegister.setDefaultLabels({ app: "birmel" });
collectDefaultMetrics({ register: metricsRegister, prefix: "birmel_" });

export const featureFlagEvaluationsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.evaluations,
  help: "Feature flag evaluations by flag and resolution reason",
  labelNames: ["flag", "reason"] as const,
  registers: [metricsRegister],
});

export const featureFlagErrorsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.errors,
  help: "Feature flag provider errors by operation",
  labelNames: ["operation"] as const,
  registers: [metricsRegister],
});

export const featureFlagSnapshotAgeSeconds = new Gauge({
  name: FEATURE_FLAG_METRICS.snapshotAge,
  help: "Seconds since the feature flag snapshot refreshed successfully",
  registers: [metricsRegister],
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

export const admissionClassifierTotal = new Counter({
  name: "birmel_admission_classifier_total",
  help: "Birmel admission classifier outcomes",
  labelNames: ["outcome"] as const,
  registers: [metricsRegister],
});

export const memoryExtractionTotal = new Counter({
  name: "birmel_memory_extraction_total",
  help: "Birmel post-response memory extraction outcomes",
  labelNames: ["outcome"] as const,
  registers: [metricsRegister],
});
