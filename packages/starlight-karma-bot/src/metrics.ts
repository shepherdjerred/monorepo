import { Counter, Gauge, Registry } from "prom-client";
import {
  createFlagMetricsRecorder,
  createFlagMetricSet,
} from "@shepherdjerred/feature-flags/observability.ts";

export const registry = new Registry();

export const featureFlagMetrics = createFlagMetricsRecorder(
  createFlagMetricSet({
    counter: (definition) =>
      new Counter({ ...definition, registers: [registry] }),
    gauge: (definition) => new Gauge({ ...definition, registers: [registry] }),
  }),
);
