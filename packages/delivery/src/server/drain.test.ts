import { describe, expect, test } from "vitest";
import { createDrain } from "./drain.ts";

type Harness = {
  /** When proxies stop routing to this pod; never when undefined. */
  movedAt?: number;
  /** Requests that land on the way, by time. */
  arrivals?: Record<number, string[]>;
  /** The routing read fails instead of answering. */
  unreadable?: boolean;
};

/** A clock that only moves when the drain sleeps. */
function harness({ movedAt, arrivals = {}, unreadable = false }: Harness) {
  let clock = 0;
  const reads: number[] = [];
  const drain = createDrain({
    quietMs: 2000,
    pollMs: 500,
    maxMs: 25_000,
    now: () => clock,
    unrouted: async () => {
      reads.push(clock);
      if (unreadable) throw new Error("endpoint read refused");
      return movedAt !== undefined && clock >= movedAt;
    },
    sleep: async (ms) => {
      const from = clock;
      const until = clock + ms;
      for (const [at, paths] of Object.entries(arrivals)) {
        const time = Number(at);
        if (time <= from || time > until) continue;
        clock = time;
        for (const path of paths)
          drain.observe(new Request(`http://delivery.test${path}`));
      }
      clock = until;
      await Promise.resolve();
    },
  });
  return { drain, reads, elapsed: () => clock };
}

describe("the API's shutdown drain", () => {
  test("is not draining until shutdown begins", () => {
    expect(harness({}).drain.draining()).toBe(false);
  });

  test("an idle pod waits for routing to move, then one quiet window", async () => {
    const { drain, elapsed } = harness({ movedAt: 3000 });
    await drain.untilDrained();
    expect(drain.draining()).toBe(true);
    expect(elapsed()).toBe(5000);
  });

  test("a quiet pod is not drained while it is still routed", async () => {
    // Nothing arrives, yet without the endpoint evidence the pod keeps
    // serving: absence of requests between sparse polls proves nothing.
    const { drain, elapsed } = harness({ movedAt: 12_000 });
    await drain.untilDrained();
    expect(elapsed()).toBe(14_000);
  });

  test("requests still arriving after routing moved extend the drain", async () => {
    const { drain, elapsed } = harness({
      movedAt: 1000,
      arrivals: { 2500: ["/api/v1/deployments/d1"] },
    });
    await drain.untilDrained();
    expect(elapsed()).toBe(4500);
  });

  test("probes and scrapes are not evidence of routing", async () => {
    const { drain, elapsed } = harness({
      movedAt: 1000,
      arrivals: { 2000: ["/readyz", "/healthz", "/metrics"] },
    });
    await drain.untilDrained();
    expect(elapsed()).toBe(3000);
  });

  test("without routing evidence the drain holds until its bound", async () => {
    const { drain, elapsed } = harness({});
    await drain.untilDrained();
    expect(elapsed()).toBe(25_000);
  });

  test("an unreadable endpoint is not evidence and keeps being asked", async () => {
    const { drain, reads, elapsed } = harness({ unreadable: true });
    await drain.untilDrained();
    expect(elapsed()).toBe(25_000);
    expect(reads.length).toBeGreaterThan(40);
  });
});
