import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import type * as Activity from "@temporalio/activity";
import {
  effectSignal,
  withLeaseLoss,
} from "#lib/delivery/model/effect-signal.ts";
import { withStaticActivityRuntime } from "#activities/delivery/static-site.ts";
import { withLeaseRenewal } from "./lease.ts";

vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
}));

const LEASE_MS = 900_000;
const expiry = () => new Date(Date.now() + LEASE_MS).toISOString();

/**
 * An effect in flight for `ms`, as a sync's Argo CLI or a Job wait is, that
 * stops when its `effectSignal` aborts.
 */
async function effect(ms: number) {
  const signal = effectSignal();
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve("synced");
    }, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error(String(signal.reason)));
      },
      { once: true },
    );
  });
}

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
      { expiresAt, renew, failed: vi.fn(), lost: vi.fn() },
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
      { expiresAt: expiry(), renew, failed, lost: vi.fn() },
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
      { expiresAt: null, renew, failed: vi.fn(), lost: vi.fn() },
      async () => await step(1_200_000),
    );
    await vi.advanceTimersByTimeAsync(1_200_000);
    await expect(result).resolves.toBe("synced");
    expect(renew).not.toHaveBeenCalled();
  });

  test("a renewed lease leaves the step's effects running to completion", async () => {
    const lost = vi.fn();
    const result = withLeaseRenewal(
      {
        expiresAt: expiry(),
        renew: () => Promise.resolve(expiry()),
        failed: vi.fn(),
        lost,
      },
      async () => await effect(1_200_000),
    );
    await vi.advanceTimersByTimeAsync(1_200_000);
    await expect(result).resolves.toBe("synced");
    expect(lost).not.toHaveBeenCalled();
  });

  test("a refused renewal aborts the step's effects in flight at once (D7)", async () => {
    const lost = vi.fn();
    const result = withLeaseRenewal(
      {
        expiresAt: expiry(),
        renew: () =>
          Promise.reject(
            ApplicationFailure.nonRetryable(
              "Delivery API deployments/d/lease returned HTTP 409",
              "DeliveryApi:CONFLICT",
            ),
          ),
        failed: vi.fn(),
        lost,
      },
      async () => await effect(1_200_000),
    );
    const settled = expect(result).rejects.toThrow(
      /The server refused the lease renewal: Delivery API deployments\/d\/lease returned HTTP 409/u,
    );
    // The first renewal is due at half the lease and is refused there,
    // long before the effect or the lease would have ended.
    await vi.advanceTimersByTimeAsync(450_000);
    await settled;
    expect(lost).toHaveBeenCalledTimes(1);
  });

  test("a lease whose expiry passes without a renewal aborts the step's effects (D7)", async () => {
    const lost = vi.fn();
    const failed = vi.fn();
    const result = withLeaseRenewal(
      {
        expiresAt: expiry(),
        renew: () => Promise.reject(new Error("Delivery API unavailable")),
        failed,
        lost,
      },
      async () => await effect(1_200_000),
    );
    const settled = expect(result).rejects.toThrow(
      /lease expired at 1970-01-01T00:15:00.000Z without a renewal/u,
    );
    // Transient failures are retried while the lease still holds.
    await vi.advanceTimersByTimeAsync(899_999);
    expect(lost).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("the static-site runtime of a model step", () => {
  test("its bucket sync, receipt and purge stop once the step's lease is lost (D7)", async () => {
    const lost = new AbortController();
    const seen: boolean[] = [];
    await expect(
      withLeaseLoss(
        lost.signal,
        async () =>
          await withStaticActivityRuntime(({ signal }) => {
            seen.push(signal.aborted);
            lost.abort(new Error("lease lost"));
            seen.push(signal.aborted);
            return Promise.resolve();
          }),
      ),
    ).rejects.toThrow("lease lost");
    expect(seen).toEqual([false, true]);
  });
});
