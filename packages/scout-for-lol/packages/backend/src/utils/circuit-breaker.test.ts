import { describe, expect, test, beforeEach, mock } from "bun:test";
import * as RealSentry from "@sentry/bun";

// Spy on Sentry.captureException so we can assert exactly when the breaker
// reports. Spread the real module so sibling test files that rely on other
// Sentry exports aren't broken by this process-global mock.
const captureException = mock(
  (_error: unknown, _options?: { tags?: Record<string, string> }): void =>
    undefined,
);
await mock.module("@sentry/bun", () => ({
  ...RealSentry,
  captureException,
}));

// Import AFTER the mock so the breaker binds to the spied captureException.
const { CircuitBreaker } = await import("#src/utils/circuit-breaker.ts");

// Mirror of the module-private OPEN_THRESHOLD constant.
const OPEN_THRESHOLD = 5;

describe("CircuitBreaker", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  test("does not report isolated failures below the open threshold", () => {
    const cb = new CircuitBreaker("test");
    for (let i = 0; i < OPEN_THRESHOLD - 1; i++) {
      cb.recordFailure(new Error("blip"), { source: "spectator" });
    }
    expect(captureException).not.toHaveBeenCalled();
    expect(cb.getState()).toBe("closed");
    expect(cb.getConsecutiveFailures()).toBe(OPEN_THRESHOLD - 1);
  });

  test("reports once when sustained failures trip the breaker open", () => {
    const cb = new CircuitBreaker("test");
    for (let i = 0; i < OPEN_THRESHOLD; i++) {
      cb.recordFailure(new Error("outage"), { source: "spectator" });
    }
    expect(cb.getState()).toBe("open");
    expect(captureException).toHaveBeenCalledTimes(1);
    const options = captureException.mock.calls[0]?.[1];
    expect(options?.tags?.["circuitState"]).toBe("open");
    expect(options?.tags?.["consecutiveFailures"]).toBe(
      OPEN_THRESHOLD.toString(),
    );
  });

  test("rate-limits repeated reports within the window", () => {
    const cb = new CircuitBreaker("test");
    for (let i = 0; i < OPEN_THRESHOLD + 3; i++) {
      cb.recordFailure(new Error("outage"), { source: "spectator" });
    }
    // Despite more failures past the threshold, only one event in the window.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test("recordSuccess resets the failure count and closes the circuit", () => {
    const cb = new CircuitBreaker("test");
    for (let i = 0; i < OPEN_THRESHOLD; i++) {
      cb.recordFailure(new Error("outage"), { source: "spectator" });
    }
    expect(cb.getState()).toBe("open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.getConsecutiveFailures()).toBe(0);
  });

  test("a flaky service that always recovers before the threshold never reports", () => {
    const cb = new CircuitBreaker("test");
    // The Bugsink case: one player's spectator lookups intermittently 5xx but
    // recover on the next poll, so consecutiveFailures never reaches the trip
    // threshold.
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < OPEN_THRESHOLD - 1; i++) {
        cb.recordFailure(new Error("blip"), { source: "spectator" });
      }
      cb.recordSuccess();
    }
    expect(captureException).not.toHaveBeenCalled();
    expect(cb.getState()).toBe("closed");
  });
});
