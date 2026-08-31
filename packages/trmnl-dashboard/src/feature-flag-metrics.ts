import { Counter, Gauge, Registry } from "prom-client";
import {
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
  const snapshotAge = new Gauge({
    name: FEATURE_FLAG_METRICS.snapshotAge,
    help: "Seconds since the feature flag snapshot refreshed successfully",
    registers: [registry],
  });

  return {
    recorder: {
      countEvaluation: (event) => {
        evaluations.inc({ flag: event.flag, reason: event.reason });
      },
      countError: (operation) => {
        errors.inc({ operation });
      },
      observeSnapshotAge: (seconds) => {
        snapshotAge.set(seconds);
      },
    },
    render: () => registry.metrics(),
  };
}

export const featureFlagMetrics = createFeatureFlagMetrics();
