import { describe, expect, test, vi } from "vitest";
import { RiotHttpError } from "./errors.ts";
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

    await vi.waitFor(() => expect(clock.pendingSleeps()).toBe(1));
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

  test("retains exponential 503 backoff without a global cooldown", async () => {
    const { runtime, sleeps } = createAdvancingRuntime();
    const limiter = new RateLimiter({ maxRetries: 2 }, runtime);
    let calls = 0;

    await limiter.execute("https://example.test/unavailable", async () => {
      calls += 1;
      return calls <= 2
        ? new Response("unavailable", { status: 503 })
        : new Response("ok");
    });

    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
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
});
