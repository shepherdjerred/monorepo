import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withLeaseRenewal } from "./lease.ts";

const LEASE_MS = 900_000;
const expiry = () => new Date(Date.now() + LEASE_MS).toISOString();

/** A step that settles after `ms`, as a sync waiting on ArgoCD does. */
async function step(ms: number) {
  return await new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve("synced");
    }, ms);
  });
}

describe("withLeaseRenewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("renews before the lease lapses for as long as a long step runs, then stops", async () => {
    let expiresAt = expiry();
    const renewedAt: number[] = [];
    const renew = vi.fn(() => {
      // Every renewal lands before the lease it extends has lapsed.
      expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
      renewedAt.push(Date.now());
      expiresAt = expiry();
      return Promise.resolve(expiresAt);
    });
    const result = withLeaseRenewal(
      { expiresAt, renew, failed: vi.fn() },
      async () => await step(1_200_000),
    );
    await vi.advanceTimersByTimeAsync(1_200_000);
    await expect(result).resolves.toBe("synced");
    expect(renewedAt).toEqual([450_000, 900_000]);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  test("a failed renewal is reported and retried before the lease lapses", async () => {
    const failure = new Error("Delivery API unavailable");
    const renewedAt: number[] = [];
    const renew = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => {
        renewedAt.push(Date.now());
        return Promise.reject(failure);
      })
      .mockImplementation(() => {
        renewedAt.push(Date.now());
        return Promise.resolve(expiry());
      });
    const failed = vi.fn();
    const result = withLeaseRenewal(
      { expiresAt: expiry(), renew, failed },
      async () => await step(800_000),
    );
    await vi.advanceTimersByTimeAsync(800_000);
    await expect(result).resolves.toBe("synced");
    expect(failed).toHaveBeenCalledWith(failure);
    // The retry is due at half the time the original lease had left.
    expect(renewedAt).toEqual([450_000, 675_000]);
  });

  test("a handed-off deployment holds no lease to renew", async () => {
    const renew = vi.fn(() => Promise.resolve(expiry()));
    const result = withLeaseRenewal(
      { expiresAt: null, renew, failed: vi.fn() },
      async () => await step(1_200_000),
    );
    await vi.advanceTimersByTimeAsync(1_200_000);
    await expect(result).resolves.toBe("synced");
    expect(renew).not.toHaveBeenCalled();
  });
});
