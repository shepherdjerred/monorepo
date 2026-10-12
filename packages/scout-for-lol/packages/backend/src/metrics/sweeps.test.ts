import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DATABASE_METRIC_SWEEP_MAX_AGE_MS,
  resetDatabaseMetricSweepStateForTests,
  sweepDatabaseMetricsWhenStale,
} from "#src/metrics/sweeps.ts";

beforeEach(() => {
  resetDatabaseMetricSweepStateForTests();
});

function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

async function succeed(): Promise<void> {
  await Promise.resolve();
}

/** A sweep the test settles by hand, to observe a refresh still in flight. */
function deferredSweep() {
  const settle: { resolve?: () => void; reject?: (error: Error) => void } = {};
  const sweep = vi.fn(
    async () =>
      await new Promise<void>((resolve, reject) => {
        settle.resolve = resolve;
        settle.reject = reject;
      }),
  );
  return { sweep, settle };
}

describe("sweepDatabaseMetricsWhenStale", () => {
  test("waits for the first sweep so no scrape serves unwritten gauges", async () => {
    let finished = false;
    const sweep = vi.fn(async () => {
      await succeed();
      finished = true;
    });
    await sweepDatabaseMetricsWhenStale(sweep, clock().now);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(finished).toBe(true);
  });

  test("serves fresh results without touching the database", async () => {
    const time = clock();
    const sweep = vi.fn(succeed);
    await sweepDatabaseMetricsWhenStale(sweep, time.now);
    time.advance(DATABASE_METRIC_SWEEP_MAX_AGE_MS - 1);
    await sweepDatabaseMetricsWhenStale(sweep, time.now);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  test("refreshes stale results in the background without blocking", async () => {
    const time = clock();
    await sweepDatabaseMetricsWhenStale(succeed, time.now);
    time.advance(DATABASE_METRIC_SWEEP_MAX_AGE_MS);

    const { sweep, settle } = deferredSweep();
    // Returns while the refresh is still running.
    await sweepDatabaseMetricsWhenStale(sweep, time.now);
    // A concurrent stale scrape joins the same in-flight refresh.
    await sweepDatabaseMetricsWhenStale(sweep, time.now);
    expect(sweep).toHaveBeenCalledTimes(1);
    settle.resolve?.();
  });

  test("a failed first sweep fails the scrape and is retried next time", async () => {
    const failing = vi.fn(async () => {
      await succeed();
      throw new Error("database down");
    });
    await expect(
      sweepDatabaseMetricsWhenStale(failing, clock().now),
    ).rejects.toThrow("database down");
    const healthy = vi.fn(succeed);
    await sweepDatabaseMetricsWhenStale(healthy, clock().now);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  test("a failed background refresh makes the next scrape wait for a sweep", async () => {
    const time = clock();
    await sweepDatabaseMetricsWhenStale(succeed, time.now);
    time.advance(DATABASE_METRIC_SWEEP_MAX_AGE_MS);

    const { sweep, settle } = deferredSweep();
    await sweepDatabaseMetricsWhenStale(sweep, time.now);
    settle.reject?.(new Error("database down"));
    await vi.waitFor(async () => {
      const next = vi.fn(async () => {
        await succeed();
        throw new Error("still down");
      });
      await expect(
        sweepDatabaseMetricsWhenStale(next, time.now),
      ).rejects.toThrow("still down");
    });
  });
});
