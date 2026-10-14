import { expect, test } from "vitest";
import { contributeGauge } from "#src/observability/gauge-contribution.ts";
import { streamActive, sinkBufferBytes } from "#src/observability/metrics.ts";

async function value(gauge: typeof streamActive) {
  const metric = await gauge.get();
  return metric.values[0]?.value;
}

test("starting and stopping one stream preserves concurrent activity and buffers", async () => {
  const first = contributeGauge(streamActive, "sum");
  const second = contributeGauge(streamActive, "sum");
  const idle = contributeGauge(streamActive, "sum");
  const firstBuffer = contributeGauge(sinkBufferBytes, "sum");
  const secondBuffer = contributeGauge(sinkBufferBytes, "sum");
  try {
    first.set(1);
    second.set(1);
    idle.set(0);
    firstBuffer.set(100);
    secondBuffer.set(200);
    expect(await value(streamActive)).toBe(2);
    expect(await value(sinkBufferBytes)).toBe(300);
    first.close();
    first.close();
    firstBuffer.close();
    first.set(1);
    firstBuffer.set(999);
    expect(await value(streamActive)).toBe(1);
    expect(await value(sinkBufferBytes)).toBe(200);
    second.close();
    secondBuffer.close();
    expect(await value(streamActive)).toBe(0);
    expect(await value(sinkBufferBytes)).toBe(0);
  } finally {
    for (const scope of [first, second, idle, firstBuffer, secondBuffer])
      scope.close();
  }
});
