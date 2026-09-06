import { Counter, Gauge, Registry } from "prom-client";
import {
  createFlagMetricsRecorder,
  FEATURE_FLAG_METRICS,
  type FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

export type FeatureFlagMetrics = {
  recorder: FlagMetricsRecorder;
  render: () => Promise<string>;
};

export function createFeatureFlagMetrics(): FeatureFlagMetrics {
  const registry = new Registry();
  const evaluations = new Counter({
    name: FEATURE_FLAG_METRICS.evaluations,
    help: "Feature flag evaluations by flag and resolution reason",
    labelNames: ["flag", "reason"] as const,
    registers: [registry],
  });
  const errors = new Counter({
    name: FEATURE_FLAG_METRICS.errors,
    help: "Feature flag provider errors by operation",
    labelNames: ["operation"] as const,
    registers: [registry],
  });
  const providerReady = new Gauge({
    name: FEATURE_FLAG_METRICS.providerReady,
    help: "Whether the feature flag provider is ready to evaluate",
    registers: [registry],
  });
  const snapshotAge = new Gauge({
    name: FEATURE_FLAG_METRICS.snapshotAge,
    help: "Seconds since the feature flag snapshot refreshed successfully",
    registers: [registry],
  });

  return {
    recorder: createFlagMetricsRecorder({
      evaluations,
      errors,
      providerReady,
      snapshotAge,
    }),
    render: () => registry.metrics(),
  };
}

export const featureFlagMetrics = createFeatureFlagMetrics();
