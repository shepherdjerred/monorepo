// Main-thread half of the metric bridge: replays a worker's batched
// observations into the real prom-client instruments (the ones /metrics
// scrapes). Observation-for-observation identical to the in-process sink, so
// dashboards see no semantic change when the emulator moves to the Worker.
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
  eventLoopLagMs,
} from "#src/observability/metrics.ts";
import type { MetricBatch } from "./metric-bridge.ts";

export function replayMetricBatch(batch: MetricBatch): void {
  for (const v of batch.emulateMs) emulateMs.observe(v);
  for (const v of batch.lateMs) lateMs.observe(v);
  for (const v of batch.copyMs) copyMs.observe(v);
  for (const v of batch.inputApplyDelayMs) inputApplyDelayMs.observe(v);
  for (const v of batch.eventLoopLagMs)
    eventLoopLagMs.observe({ thread: "emulator_worker" }, v);
  if (batch.ticks > 0) ticksTotal.inc(batch.ticks);
  for (let i = 0; i < batch.loopResyncs; i++) loopResyncTotal.inc();
  for (const reason of batch.restarts) emulatorRestartsTotal.inc({ reason });
}
