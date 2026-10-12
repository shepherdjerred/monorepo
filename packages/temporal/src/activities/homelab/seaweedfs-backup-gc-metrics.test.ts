import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { runGcCycle } from "@shepherdjerred/seaweedfs-backup/gc";
import type * as BackupRetention from "@shepherdjerred/seaweedfs-backup/retention";
import { seaweedFsBackupGcRevalidationFailuresTotal } from "#observability/metrics-backup.ts";
import { seaweedFsBackupActivities } from "./seaweedfs-backup.ts";

const maintenance = vi.hoisted(() => ({
  cancellation: new AbortController(),
  heartbeat: vi.fn(),
  runGcCycle: vi.fn(),
  pruneExpiredSnapshots: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: maintenance.cancellation.signal,
      heartbeat: maintenance.heartbeat,
    }),
  },
}));

vi.mock("@shepherdjerred/seaweedfs-backup/gc", () => ({
  runGcCycle: maintenance.runGcCycle,
}));

vi.mock(
  "@shepherdjerred/seaweedfs-backup/retention",
  async (importOriginal) => ({
    ...(await importOriginal<typeof BackupRetention>()),
    pruneExpiredSnapshots: maintenance.pruneExpiredSnapshots,
  }),
);

vi.mock("@shepherdjerred/seaweedfs-backup/store", () => ({
  storesFromEnvironment: () => ({ destination: {}, backupBucket: "test" }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  maintenance.cancellation = new AbortController();
  maintenance.heartbeat.mockReset();
  maintenance.runGcCycle.mockReset();
  maintenance.pruneExpiredSnapshots.mockReset();
  maintenance.pruneExpiredSnapshots.mockResolvedValue({
    deletedSnapshots: 0,
    markers: [],
  });
  seaweedFsBackupGcRevalidationFailuresTotal.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

function waitForGcAbort(failure: Error): Promise<AbortSignal> {
  const entered = Promise.withResolvers<AbortSignal>();
  maintenance.runGcCycle.mockImplementation(
    ({ hooks }: Parameters<typeof runGcCycle>[0]) => {
      const signal = hooks?.signal;
      if (signal === undefined) throw new Error("Missing GC abort signal");
      entered.resolve(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(failure), { once: true });
      });
    },
  );
  return entered.promise;
}

async function failures(): Promise<number | undefined> {
  const metric = await seaweedFsBackupGcRevalidationFailuresTotal.get();
  return metric.values[0]?.value;
}

describe("SeaweedFS maintenance revalidation failure metrics", () => {
  test("rethrows Activity cancellation without reporting a revalidation failure", async () => {
    const failure = new Error("Activity cancelled");
    const entered = waitForGcAbort(failure);
    const operation =
      seaweedFsBackupActivities.runSeaweedFsBackupRetentionAndGc();
    const rejected = expect(operation).rejects.toBe(failure);
    const signal = await entered;
    maintenance.cancellation.abort(failure);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(failure);
    expect(await failures()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("rethrows heartbeat abort without reporting a revalidation failure", async () => {
    const failure = new Error("Heartbeat rejected");
    maintenance.heartbeat.mockImplementationOnce(() => {
      /* Initial heartbeat succeeds. */
    });
    maintenance.heartbeat.mockImplementation(() => {
      throw failure;
    });
    const entered = waitForGcAbort(failure);
    const operation =
      seaweedFsBackupActivities.runSeaweedFsBackupRetentionAndGc();
    const rejected = expect(operation).rejects.toBe(failure);
    const signal = await entered;
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(failure);
    expect(await failures()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("counts and rethrows GC protection failures when the Activity is not aborted", async () => {
    const failure = new Error(
      "Manifest checksum mismatch for snapshots/protected.json.gz",
    );
    maintenance.runGcCycle.mockRejectedValueOnce(failure);
    await expect(
      seaweedFsBackupActivities.runSeaweedFsBackupRetentionAndGc(),
    ).rejects.toBe(failure);
    expect(maintenance.cancellation.signal.aborted).toBe(false);
    expect(await failures()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("counts and rethrows retention failures when the Activity is not aborted", async () => {
    const failure = new Error("Retention metadata unavailable");
    maintenance.pruneExpiredSnapshots.mockRejectedValueOnce(failure);
    await expect(
      seaweedFsBackupActivities.runSeaweedFsBackupRetentionAndGc(),
    ).rejects.toBe(failure);
    expect(maintenance.runGcCycle).not.toHaveBeenCalled();
    expect(await failures()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
