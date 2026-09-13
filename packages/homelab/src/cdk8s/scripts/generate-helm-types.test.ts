import { describe, expect, test } from "vitest";
import { helmFetchRetryDelayMs } from "./generate-helm-types.ts";

describe("helmFetchRetryDelayMs", () => {
  test("backs off exponentially from the base delay", () => {
    expect(helmFetchRetryDelayMs(1, 0)).toBe(5000);
    expect(helmFetchRetryDelayMs(2, 0)).toBe(10_000);
    expect(helmFetchRetryDelayMs(3, 0)).toBe(20_000);
    expect(helmFetchRetryDelayMs(4, 0)).toBe(40_000);
  });

  test("outlasts a per-minute registry quota window before giving up", () => {
    // The generator makes 5 attempts, so it waits 4 times. Even with zero
    // jitter those waits must exceed the 60s window a 429 quota resets on,
    // otherwise a single quota blip fails the deploy-paths gate.
    const totalMs = [1, 2, 3, 4].reduce(
      (sum, attempt) => sum + helmFetchRetryDelayMs(attempt, 0),
      0,
    );
    expect(totalMs).toBeGreaterThan(60_000);
  });

  test("caps the exponential growth", () => {
    expect(helmFetchRetryDelayMs(10, 0)).toBe(60_000);
  });

  test("jitter only ever lengthens a wait, by at most 25%", () => {
    const nominal = helmFetchRetryDelayMs(2, 0);
    expect(helmFetchRetryDelayMs(2, 0.5)).toBe(11_250);
    expect(helmFetchRetryDelayMs(2, 0.999)).toBeGreaterThan(nominal);
    expect(helmFetchRetryDelayMs(2, 0.999)).toBeLessThanOrEqual(nominal * 1.25);
  });

  test("rejects out-of-range inputs instead of silently retrying wrong", () => {
    expect(() => helmFetchRetryDelayMs(0, 0)).toThrow();
    expect(() => helmFetchRetryDelayMs(1.5, 0)).toThrow();
    expect(() => helmFetchRetryDelayMs(1, 1)).toThrow();
    expect(() => helmFetchRetryDelayMs(1, -0.1)).toThrow();
  });
});
