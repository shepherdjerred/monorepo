// Indirection between the engine and Prometheus, so tests can observe what the
// engine reports without touching the process-global registry.
import { ticksTotal } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
  inputApplyDelayMs,
  emulatorRestartsTotal,
} from "#src/observability/metrics.ts";

export type MetricSink = {
  /** Arrival→latch delay for one controller input. */
  observeInputApplyDelayMs: (valueMs: number) => void;
  /** Frames delivered (count). */
  incTicks: (count: number) => void;
  /** Engine restart requested by a lifecycle event. */
  incRestarts: (reason: string) => void;
};

/** Observes the real prom-client instruments in this process. */
export function createPromMetricSink(): MetricSink {
  return {
    observeInputApplyDelayMs(valueMs) {
      inputApplyDelayMs.observe(valueMs);
    },
    incTicks(count) {
      ticksTotal.inc(count);
    },
    incRestarts(reason) {
      emulatorRestartsTotal.inc({ reason });
    },
  };
}
