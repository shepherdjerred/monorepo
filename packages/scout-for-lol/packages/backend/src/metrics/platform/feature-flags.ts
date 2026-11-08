import { Counter, Gauge } from "prom-client";
import {
  createFlagMetricsRecorder,
  createFlagMetricSet,
} from "@shepherdjerred/feature-flags/observability.ts";
import { registry } from "#src/metrics/registry.ts";

const metrics = createFlagMetricSet({
  counter: (definition) =>
    new Counter({ ...definition, registers: [registry] }),
  gauge: (definition) => new Gauge({ ...definition, registers: [registry] }),
});

export const {
  evaluations: featureFlagEvaluationsTotal,
  errors: featureFlagErrorsTotal,
  providerReady: featureFlagProviderReady,
  snapshotAge: featureFlagSnapshotAgeSeconds,
} = metrics;
export const featureFlagMetrics = createFlagMetricsRecorder(metrics);
