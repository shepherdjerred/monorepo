import { beforeEach, expect, test } from "vitest";
import { contributeGauge } from "#src/observability/gauge-contribution.ts";
import {
  emulateMs,
  runtimeGauge,
  streamActive,
  ticksTotal,
} from "#src/observability/metrics.ts";

beforeEach(() => {
  streamActive.reset();
  ticksTotal.reset();
  emulateMs.reset();
});

test("closing one runtime preserves other games and copies of the same game", async () => {
  const first = contributeGauge(runtimeGauge(streamActive, "mk64"), "sum");
  const second = contributeGauge(runtimeGauge(streamActive, "mk64"), "sum");
  const emerald = contributeGauge(runtimeGauge(streamActive, "emerald"), "sum");
  try {
    first.set(1);
    second.set(1);
    emerald.set(1);
    const active = await streamActive.get();
    expect(active.values).toEqual([
      { value: 2, labels: { runtime: "mk64" } },
      { value: 1, labels: { runtime: "emerald" } },
    ]);
    first.close();
    first.set(99);
    const closed = await streamActive.get();
    expect(closed.values).toEqual([
      { value: 1, labels: { runtime: "mk64" } },
      { value: 1, labels: { runtime: "emerald" } },
    ]);
  } finally {
    first.close();
    second.close();
    emerald.close();
  }
});

test("runtime frame counts and timing distributions remain independent", async () => {
  ticksTotal.inc({ runtime: "mk64" }, 30);
  ticksTotal.inc({ runtime: "emerald" }, 60);
  emulateMs.observe({ runtime: "mk64" }, 1);
  emulateMs.observe({ runtime: "emerald" }, 100);
  const ticks = await ticksTotal.get();
  expect(ticks.values).toEqual([
    { value: 30, labels: { runtime: "mk64" } },
    { value: 60, labels: { runtime: "emerald" } },
  ]);
  const timings = await emulateMs.get();
  expect(
    timings.values.filter((sample) => sample.metricName?.endsWith("_sum")),
  ).toEqual([
    {
      metricName: "emulator_frame_emulate_ms_sum",
      value: 1,
      labels: { runtime: "mk64" },
    },
    {
      metricName: "emulator_frame_emulate_ms_sum",
      value: 100,
      labels: { runtime: "emerald" },
    },
  ]);
});
