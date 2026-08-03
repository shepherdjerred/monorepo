// Worker-side MetricSink: accumulates observations in-process and ships them
// to the main thread in a periodic batch (one postMessage per flush instead of
// ~5 per frame). The main thread replays them into the real prom instruments
// (metric-replay.ts), so histogram percentiles and counter rates are identical
// to observing in-process — just delayed by up to one flush interval.
import type { MetricSink } from "#src/emulator/metric-sink.ts";

export type MetricBatch = {
  emulateMs: number[];
  lateMs: number[];
  copyMs: number[];
  inputApplyDelayMs: number[];
  eventLoopLagMs: number[];
  ticks: number;
  loopResyncs: number;
  restarts: string[];
};

function emptyBatch(): MetricBatch {
  return {
    emulateMs: [],
    lateMs: [],
    copyMs: [],
    inputApplyDelayMs: [],
    eventLoopLagMs: [],
    ticks: 0,
    loopResyncs: 0,
    restarts: [],
  };
}

function isEmpty(batch: MetricBatch): boolean {
  return (
    batch.emulateMs.length === 0 &&
    batch.lateMs.length === 0 &&
    batch.copyMs.length === 0 &&
    batch.inputApplyDelayMs.length === 0 &&
    batch.eventLoopLagMs.length === 0 &&
    batch.ticks === 0 &&
    batch.loopResyncs === 0 &&
    batch.restarts.length === 0
  );
}

export type BatchingMetricSink = {
  readonly sink: MetricSink;
  /**
   * Worker-thread event-loop-lag sample (outside MetricSink: the lag sampler
   * is a bridge concern, not an emulator-loop metric — in-process harness
   * runs sample their own thread directly).
   */
  observeEventLoopLagMs: (valueMs: number) => void;
  /** Post any accumulated observations now (no-op when empty). */
  flush: () => void;
  /** Final flush + stop the interval. */
  close: () => void;
};

export function createBatchingMetricSink(
  onFlush: (batch: MetricBatch) => void,
  flushIntervalMs = 1000,
): BatchingMetricSink {
  let batch = emptyBatch();
  const flush = (): void => {
    if (isEmpty(batch)) return;
    const out = batch;
    batch = emptyBatch();
    onFlush(out);
  };
  const timer = setInterval(flush, flushIntervalMs);
  // The flush timer must not keep the worker alive on its own.
  timer.unref();
  return {
    sink: {
      observeEmulateMs(valueMs) {
        batch.emulateMs.push(valueMs);
      },
      observeLateMs(valueMs) {
        batch.lateMs.push(valueMs);
      },
      observeCopyMs(valueMs) {
        batch.copyMs.push(valueMs);
      },
      observeInputApplyDelayMs(valueMs) {
        batch.inputApplyDelayMs.push(valueMs);
      },
      incTicks(count) {
        batch.ticks += count;
      },
      incLoopResync() {
        batch.loopResyncs += 1;
      },
      incRestarts(reason) {
        batch.restarts.push(reason);
      },
    },
    observeEventLoopLagMs(valueMs) {
      batch.eventLoopLagMs.push(valueMs);
    },
    flush,
    close() {
      clearInterval(timer);
      flush();
    },
  };
}
