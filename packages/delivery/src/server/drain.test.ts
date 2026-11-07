import { describe, expect, test } from "vitest";
import { createDrain } from "./drain.ts";

/** A clock that only moves when the drain sleeps, plus requests that land on the way. */
function harness(arrivals: Record<number, string[]> = {}) {
  let clock = 0;
  const slept: number[] = [];
  const drain = createDrain({
    quietMs: 2000,
    maxMs: 25_000,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      const from = clock;
      clock += ms;
      for (const [at, paths] of Object.entries(arrivals)) {
        const time = Number(at);
        if (time <= from || time > clock) continue;
        const resume = clock;
        clock = time;
        for (const path of paths)
          drain.observe(new Request(`http://delivery.test${path}`));
        clock = resume;
      }
      await Promise.resolve();
    },
  });
  return { drain, slept, elapsed: () => clock };
}

describe("the API's shutdown drain", () => {
  test("is not draining until shutdown begins", () => {
    expect(harness().drain.draining()).toBe(false);
  });

  test("an idle pod drains after one quiet window", async () => {
    const { drain, elapsed } = harness();
    await drain.untilQuiet();
    expect(drain.draining()).toBe(true);
    expect(elapsed()).toBe(2000);
  });

  test("requests still routed here extend the drain until they stop", async () => {
    const { drain, elapsed } = harness({
      1500: ["/api/v1/deployments/d1"],
      3000: ["/api/v1/deployments/d1"],
    });
    await drain.untilQuiet();
    expect(elapsed()).toBe(5000);
  });

  test("probes and scrapes are not evidence of routing", async () => {
    const { drain, elapsed } = harness({
      1000: ["/readyz", "/healthz", "/metrics"],
    });
    await drain.untilQuiet();
    expect(elapsed()).toBe(2000);
  });

  test("a pod that never goes quiet stops at the bound", async () => {
    const steady = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        (index + 1) * 1000 - 1,
        ["/api/v1/overview"],
      ]),
    );
    const { drain, elapsed } = harness(steady);
    await drain.untilQuiet();
    expect(elapsed()).toBe(25_000);
  });
});
