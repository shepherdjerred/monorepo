import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  riotApi429Total,
  riotApiAppRateLimitCount,
  riotApiAppRateLimitLimit,
  riotApiLimiterDecisionsTotal,
  riotApiLimiterWaitSeconds,
  riotApiMethodRateLimitCount,
} from "#src/metrics/riot-rate-limit.ts";
import { RiotHttpError, RiotTransportError } from "./errors.ts";
import type { RiotBudgetMode, RiotPriority } from "./rate-budget.ts";
import { RateLimiter } from "./rate-limiter.ts";

type Waiter = {
  deadline: number;
  resolve: () => void;
};

function createManualRuntime() {
  let now = 0;
  let waiters: Waiter[] = [];
  const sleeps: number[] = [];

  const runtime = {
    now: (): number => now,
    random: (): number => 0,
    sleep: (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      return new Promise<void>((resolve) => {
        waiters.push({ deadline: now + milliseconds, resolve });
      });
    },
  };

  const advanceTo = (timestamp: number): void => {
    now = timestamp;
    const due = waiters.filter((waiter) => waiter.deadline <= now);
    waiters = waiters.filter((waiter) => waiter.deadline > now);
    for (const waiter of due) {
      waiter.resolve();
    }
  };

  return {
    runtime,
    sleeps,
    advanceTo,
    pendingSleeps: (): number => waiters.length,
  };
}

function createAdvancingRuntime() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    runtime: {
      now: (): number => now,
      random: (): number => 0,
      sleep: (milliseconds: number): Promise<void> => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    },
    sleeps,
  };
}

async function captureRiotError(
  promise: Promise<Response>,
): Promise<RiotHttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RiotHttpError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected RiotHttpError");
}

describe("RateLimiter error bodies", () => {
  test("wraps request transport failures with the Riot boundary type", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);
    const cause = new TypeError("connection reset");

    await expect(
      limiter.execute("https://example.test/transport", async () => {
        throw cause;
      }),
    ).rejects.toBeInstanceOf(RiotTransportError);
  });

  test("preserves JSON error bodies", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);
    const error = await captureRiotError(
      limiter.execute("https://example.test/json", async () =>
        Response.json({ message: "bad request" }, { status: 400 }),
      ),
    );

    expect(error.body).toEqual({ message: "bad request" });
  });

  test("preserves plain-text error bodies after JSON parsing fails", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);
    const error = await captureRiotError(
      limiter.execute(
        "https://example.test/text",
        async () => new Response("upstream unavailable", { status: 502 }),
      ),
    );

    expect(error.body).toBe("upstream unavailable");
  });

  test("preserves an empty error body", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);
    const error = await captureRiotError(
      limiter.execute(
        "https://example.test/empty",
        async () => new Response(null, { status: 500 }),
      ),
    );

    expect(error.body).toBe("");
  });
});

describe("RateLimiter concurrency", () => {
  test("never exceeds the configured in-flight request count", async () => {
    const limiter = new RateLimiter({ concurrency: 2 });
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];

    const tasks = Array.from({ length: 4 }, () =>
      limiter.schedule(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        active -= 1;
      }),
    );

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    releases.shift()?.();
    await Promise.all(tasks);

    expect(maximumActive).toBe(2);
  });
});

describe("RateLimiter retries", () => {
  test("blocks a queued request for the shared Retry-After cooldown", async () => {
    const clock = createManualRuntime();
    const limiter = new RateLimiter(
      { concurrency: 1, maxRetries: 1 },
      clock.runtime,
    );
    let firstCalls = 0;
    let queuedCalls = 0;

    const first = limiter.execute("https://example.test/first", async () => {
      firstCalls += 1;
      return firstCalls === 1
        ? new Response("limited", {
            status: 429,
            headers: { "Retry-After": "1" },
          })
        : new Response("ok");
    });
    const queued = limiter.execute("https://example.test/queued", async () => {
      queuedCalls += 1;
      return new Response("ok");
    });

    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(2));
    expect(queuedCalls).toBe(0);
    clock.advanceTo(1000);
    await Promise.all([first, queued]);

    expect(firstCalls).toBe(2);
    expect(queuedCalls).toBe(1);
  });

  test("blocks requests started after a 429 until the cooldown expires", async () => {
    const clock = createManualRuntime();
    const limiter = new RateLimiter(
      { concurrency: 2, maxRetries: 1 },
      clock.runtime,
    );
    let limitedCalls = 0;
    let laterCalls = 0;

    const limited = limiter.execute(
      "https://example.test/limited",
      async () => {
        limitedCalls += 1;
        return limitedCalls === 1
          ? new Response("limited", {
              status: 429,
              headers: { "Retry-After": "1" },
            })
          : new Response("ok");
      },
    );

    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(1));
    const later = limiter.execute("https://example.test/later", async () => {
      laterCalls += 1;
      return new Response("ok");
    });
    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(2));
    expect(laterCalls).toBe(0);

    clock.advanceTo(1000);
    await Promise.all([limited, later]);
    expect(laterCalls).toBe(1);
  });

  test("honors the longest cooldown when concurrent 429 responses extend it", async () => {
    const clock = createManualRuntime();
    const limiter = new RateLimiter(
      { concurrency: 2, maxRetries: 1 },
      clock.runtime,
    );
    let shortCalls = 0;
    let longCalls = 0;

    const short = limiter.execute("https://example.test/short", async () => {
      shortCalls += 1;
      return shortCalls === 1
        ? new Response("limited", {
            status: 429,
            headers: { "Retry-After": "1" },
          })
        : new Response("ok");
    });
    const long = limiter.execute("https://example.test/long", async () => {
      longCalls += 1;
      return longCalls === 1
        ? new Response("limited", {
            status: 429,
            headers: { "Retry-After": "3" },
          })
        : new Response("ok");
    });

    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(2));
    clock.advanceTo(1000);
    await Promise.resolve();
    expect(shortCalls).toBe(1);
    expect(longCalls).toBe(1);

    clock.advanceTo(3000);
    await Promise.all([short, long]);
    expect(shortCalls).toBe(2);
    expect(longCalls).toBe(2);
  });

  test.each([undefined, "", "invalid", "-1"])(
    "defaults Retry-After %s to one second",
    async (retryAfter) => {
      const { runtime, sleeps } = createAdvancingRuntime();
      const limiter = new RateLimiter({ maxRetries: 1 }, runtime);
      let calls = 0;

      await limiter.execute("https://example.test/default", async () => {
        calls += 1;
        const headers = new Headers();
        if (retryAfter !== undefined) {
          headers.set("Retry-After", retryAfter);
        }
        return calls === 1
          ? new Response("limited", { status: 429, headers })
          : new Response("ok");
      });

      expect(sleeps).toEqual([1000]);
    },
  );

  test.each([502, 503, 504, 520, 522, 524])(
    "retains exponential %i backoff without a global cooldown",
    async (status) => {
      const { runtime, sleeps } = createAdvancingRuntime();
      const limiter = new RateLimiter({ maxRetries: 2 }, runtime);
      let calls = 0;

      await limiter.execute("https://example.test/unavailable", async () => {
        calls += 1;
        return calls <= 2
          ? new Response("unavailable", { status })
          : new Response("ok");
      });

      expect(calls).toBe(3);
      expect(sleeps).toEqual([1000, 2000]);
    },
  );

  test("does not retry a genuinely non-retryable status", async () => {
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 2 }, runtime);
    let calls = 0;

    const error = await captureRiotError(
      limiter.execute("https://example.test/not-found", async () => {
        calls += 1;
        return new Response("not found", { status: 404 });
      }),
    );

    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(error.status).toBe(404);
  });

  test("throws the final 429 with its diagnostic body after retries", async () => {
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 1 }, runtime);
    const error = await captureRiotError(
      limiter.execute("https://example.test/exhausted", async () =>
        Response.json(
          { message: "still limited" },
          { status: 429, headers: { "Retry-After": "1" } },
        ),
      ),
    );

    expect(sleeps).toEqual([1000]);
    expect(error.status).toBe(429);
    expect(error.body).toEqual({ message: "still limited" });
  });

  test("does not retry an upstream outage when retryUpstreamErrors is false", async () => {
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 2 }, runtime);
    let calls = 0;

    const error = await captureRiotError(
      limiter.execute(
        "https://example.test/non-idempotent",
        async () => {
          calls += 1;
          return new Response("bad gateway", { status: 502 });
        },
        { retryUpstreamErrors: false },
      ),
    );

    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(error.status).toBe(502);
  });

  test("still retries 429 when retryUpstreamErrors is false", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 1 }, runtime);
    let calls = 0;

    const response = await limiter.execute(
      "https://example.test/non-idempotent-429",
      async () => {
        calls += 1;
        return calls === 1
          ? new Response("limited", { status: 429 })
          : new Response("ok");
      },
      { retryUpstreamErrors: false },
    );

    expect(calls).toBe(2);
    expect(response.ok).toBe(true);
  });
});

describe("RateLimiter app rate-limit gauges", () => {
  test("updates gauges from response headers on a successful response", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);

    await limiter.execute(
      "https://example.test/gauges-success",
      async () =>
        new Response("ok", {
          status: 200,
          headers: {
            "X-App-Rate-Limit": "20:1,100:120",
            "X-App-Rate-Limit-Count": "7:1,42:120",
          },
        }),
    );

    const countMetric = await riotApiAppRateLimitCount.get();
    const limitMetric = await riotApiAppRateLimitLimit.get();

    expect(
      countMetric.values.find((value) => value.labels.window_seconds === "1")
        ?.value,
    ).toBe(7);
    expect(
      limitMetric.values.find((value) => value.labels.window_seconds === "1")
        ?.value,
    ).toBe(20);
    expect(
      countMetric.values.find((value) => value.labels.window_seconds === "120")
        ?.value,
    ).toBe(42);
    expect(
      limitMetric.values.find((value) => value.labels.window_seconds === "120")
        ?.value,
    ).toBe(100);
  });

  test("records headers from every attempt, so a retried request's gauges reflect the final response", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 1 }, runtime);
    let calls = 0;

    await limiter.execute("https://example.test/gauges-retry", async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("unavailable", {
          status: 503,
          headers: {
            "X-App-Rate-Limit": "20:1",
            "X-App-Rate-Limit-Count": "19:1",
          },
        });
      }
      return new Response("ok", {
        status: 200,
        headers: {
          "X-App-Rate-Limit": "20:1",
          "X-App-Rate-Limit-Count": "3:1",
        },
      });
    });

    expect(calls).toBe(2);

    const countMetric = await riotApiAppRateLimitCount.get();
    expect(
      countMetric.values.find((value) => value.labels.window_seconds === "1")
        ?.value,
    ).toBe(3);
  });
});

describe("RateLimiter per-route metrics", () => {
  test("records route-labelled method limits and typed 429s", async () => {
    const limiter = new RateLimiter({ maxRetries: 0 });
    const url = "https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_9";

    await limiter.execute(
      url,
      async () =>
        new Response("ok", {
          headers: {
            "X-App-Rate-Limit": "20:1",
            "X-App-Rate-Limit-Count": "2:1",
            "X-Method-Rate-Limit": "2000:10",
            "X-Method-Rate-Limit-Count": "9:10",
          },
        }),
    );

    const method = await riotApiMethodRateLimitCount.get();
    expect(
      method.values.find(
        (v) =>
          v.labels.route === "europe" &&
          v.labels.method === "/lol/match/v5/matches/{matchId}" &&
          v.labels.window_seconds === "10",
      )?.value,
    ).toBe(9);
    const app = await riotApiAppRateLimitCount.get();
    expect(app.values.find((v) => v.labels.route === "europe")?.value).toBe(2);

    await expect(
      limiter.execute(
        url,
        async () =>
          new Response("", {
            status: 429,
            headers: { "X-Rate-Limit-Type": "method", "Retry-After": "0" },
          }),
      ),
    ).rejects.toBeInstanceOf(RiotHttpError);
    const total = await riotApi429Total.get();
    expect(
      total.values.find(
        (v) => v.labels.route === "europe" && v.labels.limit_type === "method",
      )?.value,
    ).toBe(1);
  });
});

/** A task that holds its limiter slot until `release` is called. */
function heldTask(started: string[], name: string) {
  let release = (): void => {
    throw new Error(`${name} has not started`);
  };
  const task = (): Promise<void> =>
    new Promise<void>((resolve) => {
      started.push(name);
      release = resolve;
    });
  return { task, release: () => release() };
}

const AMERICAS_MATCH =
  "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_1";
const AMERICAS_LIST =
  "https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/p/ids";
const EUROPE_MATCH =
  "https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_1";

function rateLimited(type: string, retryAfter = "1"): Response {
  return new Response("limited", {
    status: 429,
    headers: { "X-Rate-Limit-Type": type, "Retry-After": retryAfter },
  });
}

describe("RateLimiter priority classes", () => {
  test("a freed slot goes to the highest waiting class, FIFO within a class", async () => {
    const limiter = new RateLimiter({
      concurrency: 2,
      reservedRealtimeSlots: 0,
    });
    const started: string[] = [];
    const tasks = new Map<string, ReturnType<typeof heldTask>>();
    const runs: Promise<void>[] = [];
    const enqueue = (name: string, priority: RiotPriority): void => {
      const held = heldTask(started, name);
      tasks.set(name, held);
      runs.push(limiter.schedule(held.task, priority));
    };
    const release = async (name: string, next: string): Promise<void> => {
      tasks.get(name)?.release();
      await vi.waitFor(() => expect(started.at(-1)).toBe(next));
    };

    enqueue("hold-1", "realtime");
    enqueue("hold-2", "realtime");
    await vi.waitFor(() => expect(started).toHaveLength(2));
    enqueue("crawl", "crawl");
    enqueue("backfill-1", "backfill");
    enqueue("interactive", "interactive");
    enqueue("backfill-2", "backfill");
    enqueue("realtime", "realtime");
    await Promise.resolve();
    expect(started).toEqual(["hold-1", "hold-2"]);

    await release("hold-1", "realtime");
    await release("hold-2", "interactive");
    await release("realtime", "backfill-1");
    await release("interactive", "backfill-2");
    await release("backfill-1", "crawl");
    tasks.get("backfill-2")?.release();
    tasks.get("crawl")?.release();
    await Promise.all(runs);

    expect(started).toEqual([
      "hold-1",
      "hold-2",
      "realtime",
      "interactive",
      "backfill-1",
      "backfill-2",
      "crawl",
    ]);
  });

  test("keeps one slot for realtime however much lower-class work waits", async () => {
    const limiter = new RateLimiter({ concurrency: 3 });
    const started: string[] = [];
    const backfill = ["b1", "b2", "b3", "b4"].map((name) =>
      heldTask(started, name),
    );
    const backfillRuns = backfill.map((held) =>
      limiter.schedule(held.task, "backfill"),
    );
    await vi.waitFor(() => expect(started).toEqual(["b1", "b2"]));

    const realtime = heldTask(started, "r1");
    const realtimeRun = limiter.schedule(realtime.task, "realtime");
    await vi.waitFor(() => expect(started).toEqual(["b1", "b2", "r1"]));

    // A second realtime request waits for a slot, but ahead of backfill.
    const second = heldTask(started, "r2");
    const secondRun = limiter.schedule(second.task);
    backfill[0]?.release();
    await vi.waitFor(() => expect(started).toEqual(["b1", "b2", "r1", "r2"]));

    // Two realtime requests in flight: the one free slot is the reserved one.
    backfill[1]?.release();
    await backfillRuns[1];
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual(["b1", "b2", "r1", "r2"]);

    realtime.release();
    await vi.waitFor(() =>
      expect(started).toEqual(["b1", "b2", "r1", "r2", "b3"]),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).not.toContain("b4");

    second.release();
    await vi.waitFor(() => expect(started).toContain("b4"));
    backfill[2]?.release();
    backfill[3]?.release();
    await Promise.all([...backfillRuns, realtimeRun, secondRun]);
  });

  test("rejects a reservation that would leave lower classes no slot", () => {
    expect(
      () => new RateLimiter({ concurrency: 2, reservedRealtimeSlots: 2 }),
    ).toThrow(/reservedRealtimeSlots/);
    expect(() => new RateLimiter({ concurrency: 1 })).not.toThrow();
  });

  test("labels limiter metrics with the request's priority, defaulting to realtime", async () => {
    riotApiLimiterDecisionsTotal.reset();
    riotApiLimiterWaitSeconds.reset();
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);

    await limiter.execute(EUROPE_MATCH, async () => new Response("ok"), {
      priority: "backfill",
    });
    await limiter.execute(EUROPE_MATCH, async () => new Response("ok"));

    const decisions = await riotApiLimiterDecisionsTotal.get();
    const admitted = (priority: string) =>
      decisions.values.find(
        (v) =>
          v.labels.route === "europe" &&
          v.labels.priority === priority &&
          v.labels.outcome === "admitted",
      )?.value;
    expect(admitted("backfill")).toBe(1);
    expect(admitted("realtime")).toBe(1);
    const waits = await riotApiLimiterWaitSeconds.get();
    expect(
      waits.values.some(
        (v) =>
          v.labels.priority === "backfill" &&
          v.metricName === "riot_api_limiter_wait_seconds_count",
      ),
    ).toBe(true);
  });
});

/** A limiter whose first request to `url` is a 429 of `limitType`, left cooling. */
async function startCooling(
  url: string,
  limitType: string,
  retryAfter: string,
  concurrency = 3,
) {
  const clock = createManualRuntime();
  const limiter = new RateLimiter(
    { concurrency, maxRetries: 1 },
    clock.runtime,
  );
  let limitedCalls = 0;
  const first = limiter.execute(url, () => {
    limitedCalls += 1;
    return Promise.resolve(
      limitedCalls === 1
        ? rateLimited(limitType, retryAfter)
        : new Response("ok"),
    );
  });
  await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(1));
  return { clock, limiter, first };
}

describe("RateLimiter scoped cooldowns", () => {
  test("an application 429 cools down its route only", async () => {
    const { clock, limiter, first } = await startCooling(
      AMERICAS_MATCH,
      "application",
      "1",
    );
    const calls: string[] = [];

    const sameRoute = limiter.execute(AMERICAS_LIST, async () => {
      calls.push("americas-list");
      return new Response("ok");
    });
    const otherRoute = limiter.execute(EUROPE_MATCH, async () => {
      calls.push("europe");
      return new Response("ok");
    });
    await otherRoute;
    expect(calls).toEqual(["europe"]);

    clock.advanceTo(1000);
    await Promise.all([first, sameRoute]);
    expect(calls).toEqual(["europe", "americas-list"]);
  });

  test("a method 429 cools down that route and method only", async () => {
    const { clock, limiter, first } = await startCooling(
      AMERICAS_MATCH,
      "method",
      "2",
    );
    const calls: string[] = [];

    const sameMethod = limiter.execute(
      "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_2",
      async () => {
        calls.push("americas-match");
        return new Response("ok");
      },
    );
    const otherMethod = limiter.execute(AMERICAS_LIST, async () => {
      calls.push("americas-list");
      return new Response("ok");
    });
    await otherMethod;
    expect(calls).toEqual(["americas-list"]);

    clock.advanceTo(2000);
    await Promise.all([first, sameMethod]);
    expect(calls).toEqual(["americas-list", "americas-match"]);
  });

  test("requests waiting on a cooldown do not hold slots other scopes need", async () => {
    const { clock, limiter, first } = await startCooling(
      AMERICAS_MATCH,
      "method",
      "5",
      2,
    );

    const blocked = [1, 2, 3].map((id) =>
      limiter.execute(
        `https://americas.api.riotgames.com/lol/match/v5/matches/NA1_${id.toString()}`,
        () => Promise.resolve(new Response("ok")),
      ),
    );
    let unrelatedRan = false;
    const unrelated = limiter.execute(AMERICAS_LIST, () => {
      unrelatedRan = true;
      return Promise.resolve(new Response("ok"));
    });
    await unrelated;
    expect(unrelatedRan).toBe(true);

    clock.advanceTo(6000);
    await Promise.all([first, ...blocked]);
  });

  test("a service 429 backs off exponentially without cooling anything down", async () => {
    const clock = createManualRuntime();
    const limiter = new RateLimiter(
      { concurrency: 2, maxRetries: 3 },
      clock.runtime,
    );
    let serviceCalls = 0;
    let neighbourCalls = 0;

    const shed = limiter.execute(AMERICAS_MATCH, async () => {
      serviceCalls += 1;
      return serviceCalls <= 2
        ? new Response("busy", {
            status: 429,
            headers: { "X-Rate-Limit-Type": "service" },
          })
        : new Response("ok");
    });
    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(1));
    expect(clock.sleeps).toEqual([1000]);

    // Same route and method: not blocked by the service 429.
    await limiter.execute(AMERICAS_MATCH, async () => {
      neighbourCalls += 1;
      return new Response("ok");
    });
    expect(neighbourCalls).toBe(1);

    clock.advanceTo(1000);
    await vi.waitFor(() => expect(clock.sleeps).toEqual([1000, 2000]));
    clock.advanceTo(3000);
    await shed;
    expect(serviceCalls).toBe(3);

    const total = await riotApi429Total.get();
    expect(
      total.values.find(
        (v) =>
          v.labels.route === "americas" &&
          v.labels.limit_type === "service" &&
          v.labels.priority === "realtime",
      )?.value,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a service 429 honours a Retry-After longer than its backoff", async () => {
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 1 }, runtime);
    let calls = 0;

    await limiter.execute(AMERICAS_MATCH, async () => {
      calls += 1;
      return calls === 1 ? rateLimited("service", "5") : new Response("ok");
    });

    expect(sleeps).toEqual([5000]);
  });
});

async function decisionCount(outcome: string): Promise<number> {
  const metric = await riotApiLimiterDecisionsTotal.get();
  return metric.values
    .filter((v) => v.labels.outcome === outcome)
    .reduce((sum, v) => sum + v.value, 0);
}

/** Five concurrent requests on a route the ledger has never seen. */
async function burst(mode: RiotBudgetMode) {
  const clock = createManualRuntime();
  const limiter = new RateLimiter(
    { concurrency: 5, maxRetries: 0, budgetMode: () => mode },
    clock.runtime,
  );
  const responses: ((response: Response) => void)[] = [];
  const runs = Array.from({ length: 5 }, () =>
    limiter.execute(
      EUROPE_MATCH,
      () =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
        }),
    ),
  );
  await vi.waitFor(() => expect(responses.length).toBeGreaterThan(0));
  await new Promise((resolve) => setImmediate(resolve));
  return { clock, responses, runs };
}

// 200 of 500 is over crawl's 25% ceiling.
function overCrawlCeiling(): Promise<Response> {
  return Promise.resolve(
    new Response("ok", {
      headers: {
        "X-App-Rate-Limit": "500:10",
        "X-App-Rate-Limit-Count": "200:10",
      },
    }),
  );
}

describe("RateLimiter budget modes", () => {
  beforeEach(() => {
    riotApiLimiterDecisionsTotal.reset();
  });

  test("observe records the ledger's refusals and admits exactly as before", async () => {
    // Slow start lets one probe through; the ledger refuses the other four.
    const { responses, runs } = await burst("observe");

    expect(responses).toHaveLength(5);
    expect(await decisionCount("admitted")).toBe(1);
    expect(await decisionCount("would_defer")).toBe(4);
    expect(await decisionCount("deferred")).toBe(0);

    for (const respond of responses) {
      respond(new Response("ok"));
    }
    await Promise.all(runs);
  });

  test("observe sends a request the ledger says is over its ceiling", async () => {
    const { runtime } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 0 }, runtime);
    let calls = 0;
    const nearlyFull = () => {
      calls += 1;
      return Promise.resolve(
        new Response("ok", {
          headers: {
            "X-App-Rate-Limit": "500:10",
            "X-App-Rate-Limit-Count": "499:10",
          },
        }),
      );
    };

    await limiter.execute(EUROPE_MATCH, nearlyFull, { priority: "crawl" });
    await limiter.execute(EUROPE_MATCH, nearlyFull, { priority: "crawl" });

    expect(calls).toBe(2);
    const metric = await riotApiLimiterDecisionsTotal.get();
    expect(
      metric.values.find(
        (v) =>
          v.labels.outcome === "would_defer" && v.labels.priority === "crawl",
      )?.labels.reason,
    ).toBe("app-window");
  });

  test("enforce holds refused requests until the ledger admits them", async () => {
    const { clock, responses, runs } = await burst("enforce");

    expect(responses).toHaveLength(1);
    expect(await decisionCount("deferred")).toBe(4);

    responses[0]?.(
      new Response("ok", {
        headers: {
          "X-App-Rate-Limit": "500:10",
          "X-App-Rate-Limit-Count": "1:10",
        },
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    clock.advanceTo(100);
    await vi.waitFor(() => expect(responses).toHaveLength(5));
    for (const respond of responses.slice(1)) {
      respond(new Response("ok"));
    }
    await Promise.all(runs);
    expect(await decisionCount("would_defer")).toBe(0);
  });

  test("reads the mode on every attempt", async () => {
    let mode: RiotBudgetMode = "enforce";
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter(
      { maxRetries: 0, budgetMode: () => mode },
      runtime,
    );
    await limiter.execute(EUROPE_MATCH, overCrawlCeiling, {
      priority: "crawl",
    });
    await limiter.execute(EUROPE_MATCH, overCrawlCeiling, {
      priority: "crawl",
    });
    expect(await decisionCount("deferred")).toBe(1);
    expect(sleeps).toEqual([10_000]);

    mode = "observe";
    await limiter.execute(EUROPE_MATCH, overCrawlCeiling, {
      priority: "crawl",
    });
    expect(await decisionCount("deferred")).toBe(1);
    expect(await decisionCount("would_defer")).toBe(1);
    expect(sleeps).toEqual([10_000]);
  });
});
