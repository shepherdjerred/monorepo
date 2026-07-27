// Indirection between the emulator hot loop and Prometheus. The emulator calls
// a `MetricSink`; the default implementation observes the prom-client
// instruments directly (single-process use: harnesses, and the pre-worker
// in-process loop). When the emulator runs on a Worker thread, the worker
// injects a batching sink that ships observations to the main thread for
// replay (see worker/metric-bridge.ts), so metric names/semantics stay
// identical regardless of where the emulator executes.
import {
  emulateMs,
  lateMs,
  ticksTotal,
  loopResyncTotal,
} from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
  copyMs,
  inputApplyDelayMs,
  emulatorRestartsTotal,
} from "#src/observability/metrics.ts";

export type MetricSink = {
  /** Duration of one wasm core step. */
  observeEmulateMs: (valueMs: number) => void;
  /** How far behind schedule the paced loop is at a tick. */
  observeLateMs: (valueMs: number) => void;
  /** Duration of the frame copy out of wasm memory. */
  observeCopyMs: (valueMs: number) => void;
  /** Arrival→latch delay for one controller input. */
  observeInputApplyDelayMs: (valueMs: number) => void;
  /** Emulated frames executed (count). */
  incTicks: (count: number) => void;
  /** Paced-loop resync after falling far behind. */
  incLoopResync: () => void;
  /** Emulator restart requested by a lifecycle event. */
  incRestarts: (reason: string) => void;
};

/** Observes the real prom-client instruments in this process. */
export function createPromMetricSink(): MetricSink {
  return {
    observeEmulateMs(valueMs) {
      emulateMs.observe(valueMs);
    },
    observeLateMs(valueMs) {
      lateMs.observe(valueMs);
    },
    observeCopyMs(valueMs) {
      copyMs.observe(valueMs);
    },
    observeInputApplyDelayMs(valueMs) {
      inputApplyDelayMs.observe(valueMs);
    },
    incTicks(count) {
      ticksTotal.inc(count);
    },
    incLoopResync() {
      loopResyncTotal.inc();
    },
    incRestarts(reason) {
      emulatorRestartsTotal.inc({ reason });
    },
  };
}
