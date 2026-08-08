import { describe, expect, test } from "bun:test";
import {
  equalJitterRetryDelayMs,
  retryUntilReady,
  STARTUP_RETRY_MAXIMUM_DELAY_MS,
} from "./startup-retry.ts";

describe("equal-jitter startup retry delays", () => {
  test("doubles the ceiling and keeps delays within the equal-jitter range", () => {
    expect(equalJitterRetryDelayMs(1, 0)).toBe(5000);
    expect(equalJitterRetryDelayMs(1, 1)).toBe(10_000);
    expect(equalJitterRetryDelayMs(2, 0.5)).toBe(15_000);
  });

  test("caps the exponential ceiling at five minutes", () => {
    expect(equalJitterRetryDelayMs(20, 0)).toBe(150_000);
    expect(equalJitterRetryDelayMs(20, 1)).toBe(STARTUP_RETRY_MAXIMUM_DELAY_MS);
  });
});

describe("retryUntilReady", () => {
  test("retries a transient operation until it succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];

    const result = await retryUntilReady({
      operation: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("ECONNREFUSED");
        }
      },
      shouldRetry: () => true,
      isClosed: () => false,
      random: () => 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    expect(result).toBe("succeeded");
    expect(calls).toBe(3);
    expect(delays).toEqual([5000, 10_000]);
  });

  test("does not retry a non-transient failure", async () => {
    let calls = 0;
    let sleeps = 0;

    await expect(
      retryUntilReady({
        operation: async () => {
          calls += 1;
          throw new Error("access denied");
        },
        shouldRetry: () => false,
        isClosed: () => false,
        sleep: async () => {
          sleeps += 1;
        },
      }),
    ).rejects.toThrow("access denied");

    expect(calls).toBe(1);
    expect(sleeps).toBe(0);
  });

  test("stops after shutdown during a retry delay", async () => {
    let calls = 0;
    let closed = false;

    const result = await retryUntilReady({
      operation: async () => {
        calls += 1;
        throw new Error("ETIMEDOUT");
      },
      shouldRetry: () => true,
      isClosed: () => closed,
      random: () => 0,
      sleep: async () => {
        closed = true;
      },
    });

    expect(result).toBe("closed");
    expect(calls).toBe(1);
  });

  test("continues transient retries and escalates once", async () => {
    let calls = 0;
    let closed = false;
    const retries: number[] = [];
    const escalations: number[] = [];

    const result = await retryUntilReady({
      operation: async () => {
        calls += 1;
        throw new Error("HTTP 503");
      },
      shouldRetry: () => true,
      isClosed: () => closed,
      random: () => 0,
      onRetry: ({ attempt }) => {
        retries.push(attempt);
      },
      onEscalate: ({ attempt }) => {
        escalations.push(attempt);
      },
      sleep: async (_delayMs, isClosed) => {
        if (retries.length === 11) {
          closed = true;
        }
        expect(isClosed()).toBe(closed);
      },
    });

    expect(result).toBe("closed");
    expect(calls).toBe(11);
    expect(retries).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    expect(escalations).toEqual([10]);
  });
});
