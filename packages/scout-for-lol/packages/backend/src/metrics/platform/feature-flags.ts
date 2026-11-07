import { Counter, Gauge } from "prom-client";
import {
  createFlagMetricsRecorder,
  FEATURE_FLAG_METRICS,
} from "@shepherdjerred/feature-flags/observability.ts";
import { registry } from "#src/metrics/registry.ts";

export const featureFlagEvaluationsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.evaluations,
  help: "Feature flag evaluations by flag and resolution reason",
  labelNames: ["flag", "reason", "value"] as const,
  registers: [registry],
});

export const featureFlagErrorsTotal = new Counter({
  name: FEATURE_FLAG_METRICS.errors,
  help: "Feature flag provider errors by operation",
  labelNames: ["operation"] as const,
  registers: [registry],
});

export const featureFlagProviderReady = new Gauge({
  name: FEATURE_FLAG_METRICS.providerReady,
  help: "Whether the feature flag provider is ready to evaluate",
  registers: [registry],
});

export const featureFlagSnapshotAgeSeconds = new Gauge({
  name: FEATURE_FLAG_METRICS.snapshotAge,
  help: "Seconds since the feature flag snapshot refreshed successfully",
  registers: [registry],
});

const featureFlagProviderInfo = new Gauge({
  name: FEATURE_FLAG_METRICS.providerInfo,
  help: "The Flipt environment and namespace consumed by this process",
  labelNames: ["flipt_environment", "flipt_namespace"] as const,
  registers: [registry],
});

export const featureFlagMetrics = createFlagMetricsRecorder({
  evaluations: featureFlagEvaluationsTotal,
  errors: featureFlagErrorsTotal,
  providerReady: featureFlagProviderReady,
  snapshotAge: featureFlagSnapshotAgeSeconds,
  providerInfo: featureFlagProviderInfo,
});
