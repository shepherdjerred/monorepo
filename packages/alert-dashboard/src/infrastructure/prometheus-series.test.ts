import { describe, expect, it } from "vitest";

import { UpstreamUnavailableError } from "#application/ops-errors";
import type { SeriesRangeRequest } from "#application/ports";
import { PrometheusSeries } from "#infrastructure/prometheus-series";

function matrixResponse(value: number): Response {
  return Response.json({
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        {
          metric: { job: "test" },
          values: [[1_700_000_000, String(value)]],
        },
      ],
    },
  });
}

function makeRequest(promql: string): SeriesRangeRequest {
  return {
    promql,
    startSeconds: 1_700_000_000,
    endSeconds: 1_700_003_600,
    stepSeconds: 300,
  };
}

describe("PrometheusSeries", () => {
  it("deduplicates concurrent identical requests and caches responses for 30s", async () => {
    let now = 1000;
    let calls = 0;
    const gate = Promise.withResolvers<null>();
    const series = new PrometheusSeries("http://prometheus.local", {
      nowMs: () => now,
      ttlMs: 30_000,
      maxEntries: 2,
      fetch: async () => {
        calls += 1;
        const callNumber = calls;
        await gate.promise;
        return matrixResponse(callNumber * 10);
      },
    });

    const reqA = makeRequest("up{job='a'}");
    const first = series.range(reqA);
    const second = series.range(reqA);
    gate.resolve(null);

    const [res1, res2] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(res1[0]?.points).toEqual([[1_700_000_000, 10]]);
    expect(res2[0]?.points).toEqual([[1_700_000_000, 10]]);

    // Within 30s TTL: served from cache.
    now += 29_999;
    const cached = await series.range(reqA);
    expect(calls).toBe(1);
    expect(cached[0]?.points).toEqual([[1_700_000_000, 10]]);

    // Evicts oldest entry when exceeding maxEntries (2).
    await series.range(makeRequest("up{job='b'}"));
    await series.range(makeRequest("up{job='c'}"));
    expect(calls).toBe(3);

    // `a` was evicted by `b` and `c`.
    await series.range(reqA);
    expect(calls).toBe(4);

    // Past TTL: refetches.
    now += 30_001;
    await series.range(reqA);
    expect(calls).toBe(5);
  });

  it("caps concurrent upstream range queries at 6", async () => {
    let active = 0;
    let maxObserved = 0;
    const gates: (() => void)[] = [];

    const series = new PrometheusSeries("http://prometheus.local", {
      fetch: async () => {
        active += 1;
        maxObserved = Math.max(maxObserved, active);
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        active -= 1;
        return matrixResponse(1);
      },
    });

    const pending = Array.from({ length: 10 }, (_, index) =>
      series.range(makeRequest(`metric_${String(index)}`)),
    );

    await Bun.sleep(10);
    expect(active).toBe(6);
    expect(maxObserved).toBe(6);

    while (gates.length > 0) {
      const release = gates.shift();
      release?.();
      await Bun.sleep(5);
    }

    await Promise.all(pending);
    expect(maxObserved).toBe(6);
    expect(active).toBe(0);
  });

  it("rejects pre-aborted and semaphore-queued aborted signals without querying Prometheus", async () => {
    let calls = 0;
    const blockers: (() => void)[] = [];

    const series = new PrometheusSeries("http://prometheus.local", {
      maxConcurrency: 2,
      fetch: async () => {
        calls += 1;
        await new Promise<void>((resolve) => {
          blockers.push(resolve);
        });
        return matrixResponse(1);
      },
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      series.range(makeRequest("pre_aborted"), preAborted.signal),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(calls).toBe(0);

    // Saturate both semaphore slots.
    const slot1 = series.range(makeRequest("slot_1"));
    const slot2 = series.range(makeRequest("slot_2"));
    await Bun.sleep(10);
    expect(calls).toBe(2);

    // Queue a third request and abort it before releasing slots.
    const queuedController = new AbortController();
    const queued = series.range(
      makeRequest("queued_cancelled"),
      queuedController.signal,
    );
    await Bun.sleep(5);
    queuedController.abort();
    await expect(queued).rejects.toBeInstanceOf(UpstreamUnavailableError);

    for (const release of blockers) {
      release();
    }
    await Promise.all([slot1, slot2]);
    // The cancelled queued request never reached Prometheus.
    expect(calls).toBe(2);
  });

  it("keeps a shared singleflight alive when only one subscriber aborts", async () => {
    const gate = Promise.withResolvers<null>();
    const series = new PrometheusSeries("http://prometheus.local", {
      fetch: async (_url, init) => {
        await gate.promise;
        if (init?.signal?.aborted === true) {
          throw new Error("upstream unexpectedly aborted");
        }
        return matrixResponse(42);
      },
    });

    const req = makeRequest("shared_metric");
    const cancelA = new AbortController();
    const callA = series.range(req, cancelA.signal);
    const callB = series.range(req);

    cancelA.abort();
    await expect(callA).rejects.toBeInstanceOf(UpstreamUnavailableError);

    gate.resolve(null);
    const resultB = await callB;
    expect(resultB[0]?.points).toEqual([[1_700_000_000, 42]]);
  });
});
