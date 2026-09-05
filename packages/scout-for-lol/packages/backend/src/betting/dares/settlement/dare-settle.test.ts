import { describe, expect, test, vi } from "vitest";
import {
  DARE_SETTLE_ATTEMPTS,
  withBoundedRetry,
} from "#src/betting/dares/settlement/dare-settle-retry.ts";

describe("withBoundedRetry", () => {
  test("returns the first successful attempt without retrying further", async () => {
    const attempt = vi.fn(() => Promise.resolve("ok"));
    const result = await withBoundedRetry(attempt, 3, () => Promise.resolve());
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test("retries a transient failure and succeeds within the attempt budget", async () => {
    let calls = 0;
    const attempt = vi.fn(() => {
      calls += 1;
      if (calls < 3) {
        return Promise.reject(new Error("transient"));
      }
      return Promise.resolve("recovered");
    });
    const delays: number[] = [];
    const result = await withBoundedRetry(
      attempt,
      DARE_SETTLE_ATTEMPTS,
      (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    );
    expect(result).toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(3);
    // Two delays for the two failed attempts, none after the final success.
    expect(delays).toEqual([50, 100]);
  });

  test("exhausts the attempt budget and rethrows the last error, never a swallowed undefined", async () => {
    const persistent = new Error("still down");
    const attempt = vi.fn(() => Promise.reject(persistent));
    await expect(
      withBoundedRetry(attempt, DARE_SETTLE_ATTEMPTS, () => Promise.resolve()),
    ).rejects.toBe(persistent);
    expect(attempt).toHaveBeenCalledTimes(DARE_SETTLE_ATTEMPTS);
  });

  test("never delays after the final attempt", async () => {
    const attempt = vi.fn(() => Promise.reject(new Error("nope")));
    const delay = vi.fn(() => Promise.resolve());
    await expect(
      withBoundedRetry(attempt, DARE_SETTLE_ATTEMPTS, delay),
    ).rejects.toThrow("nope");
    expect(delay).toHaveBeenCalledTimes(DARE_SETTLE_ATTEMPTS - 1);
  });
});
