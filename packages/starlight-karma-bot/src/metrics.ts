import { Counter, Gauge, Registry } from "prom-client";
import {
  createFlagMetricsRecorder,
  FEATURE_FLAG_METRICS,
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

const featureFlagProviderReady = new Gauge({
  name: FEATURE_FLAG_METRICS.providerReady,
  help: "Whether the feature flag provider is ready to evaluate",
  registers: [registry],
});

const featureFlagSnapshotAgeSeconds = new Gauge({
  name: FEATURE_FLAG_METRICS.snapshotAge,
  help: "Seconds since the feature flag snapshot refreshed successfully",
  registers: [registry],
});

export const featureFlagMetrics = createFlagMetricsRecorder({
  evaluations: featureFlagEvaluationsTotal,
  errors: featureFlagErrorsTotal,
  providerReady: featureFlagProviderReady,
  snapshotAge: featureFlagSnapshotAgeSeconds,
});
