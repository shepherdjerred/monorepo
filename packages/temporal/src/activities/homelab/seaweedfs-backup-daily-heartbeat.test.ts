import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Readable } from "node:stream";
import { SEAWEEDFS_BACKUP_POLICY } from "@shepherdjerred/seaweedfs-backup/policy";
import * as BackupSnapshot from "@shepherdjerred/seaweedfs-backup/snapshot";
import type * as BackupStore from "@shepherdjerred/seaweedfs-backup/store";
import { seaweedFsBackupActivities } from "./seaweedfs-backup.ts";

const activity = vi.hoisted(() => ({
  cancellation: new AbortController(),
  heartbeat: vi.fn(),
  stores: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: activity.cancellation.signal,
      heartbeat: activity.heartbeat,
    }),
  },
}));

vi.mock("@shepherdjerred/seaweedfs-backup/store", async (importOriginal) => ({
  ...(await importOriginal<typeof BackupStore>()),
  storesFromEnvironment: activity.stores,
}));

let source: BackupStore.ObjectStore;
let destination: BackupStore.ObjectStore;
let execution: BackupStore.ObjectStoreExecution | undefined;
let heartbeatTimes: number[];

function emptyInventoryStores() {
  const objects = new Map<string, BackupStore.PutObjectInput>();
  const emptySource: BackupStore.ObjectStore = {
    listBuckets: () =>
      Promise.resolve(
        SEAWEEDFS_BACKUP_POLICY.buckets.map((bucket) => bucket.name),
      ),
    listObjects: () => Promise.resolve([]),
    headObject: () => Promise.resolve(undefined),
    getObject: () => {
      throw new Error("Unexpected source read in empty inventory fixture");
    },
    putObject: () => {
      throw new Error("Unexpected source write");
    },
    deleteObject: () => {
      throw new Error("Unexpected source delete");
    },
  };
  const metadataStore: BackupStore.ObjectStore = {
    ...emptySource,
    listBuckets: () => Promise.resolve(["test-backup"]),
    listObjects: (_bucket, prefix = "") =>
      Promise.resolve(
        [...objects]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, object]) => ({
            key,
            size: object.contentLength ?? 0,
            etag: '"fixture"',
            lastModified: new Date(),
          })),
      ),
    getObject: (_bucket, key) => {
      const object = objects.get(key);
      if (object === undefined) {
        throw new Error("Missing buffered metadata fixture");
      }
      if (!(object.body instanceof Uint8Array)) {
        throw new TypeError("Unexpected streaming fixture body");
      }
      return Promise.resolve({
        key,
        size: object.body.byteLength,
        etag: '"fixture"',
        lastModified: new Date(),
        body: Readable.from([object.body]),
        headers: object.headers,
      });
    },
    putObject: (object) => {
      if (!(object.body instanceof Uint8Array)) {
        throw new TypeError("Unexpected streaming payload in metadata fixture");
      }
      objects.set(object.key, object);
      return Promise.resolve();
    },
  };
  return { source: emptySource, destination: metadataStore };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
  ({ source, destination } = emptyInventoryStores());
  execution = undefined;
  heartbeatTimes = [];
  activity.cancellation = new AbortController();
  activity.heartbeat.mockReset();
  activity.heartbeat.mockImplementation(() => heartbeatTimes.push(Date.now()));
  activity.stores.mockReset();
  activity.stores.mockImplementation(
    (_environment: unknown, options?: BackupStore.ObjectStoreExecution) => {
      execution = options;
      return { source, destination, backupBucket: "test-backup" };
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function expectContinuousHeartbeats(start: number) {
  const times = heartbeatTimes.filter((time) => time >= start);
  expect(times.length).toBeGreaterThanOrEqual(6);
  expect(times.at(-1)).toBeGreaterThanOrEqual(start + 180_000);
  for (let index = 1; index < times.length; index += 1) {
    expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBeLessThanOrEqual(
      30_000,
    );
  }
}

async function expectTimerStopped() {
  expect(vi.getTimerCount()).toBe(0);
  const calls = activity.heartbeat.mock.calls.length;
  await vi.advanceTimersByTimeAsync(90_000);
  expect(activity.heartbeat).toHaveBeenCalledTimes(calls);
}

describe("daily backup heartbeat ownership", () => {
  test("heartbeats through initial coverage before any bucket progress", async () => {
    const inventory = source.listBuckets.bind(source);
    const gate = Promise.withResolvers<boolean>();
    vi.spyOn(source, "listBuckets").mockImplementationOnce(async () => {
      await gate.promise;
      return inventory();
    });
    const operation = seaweedFsBackupActivities.runSeaweedFsBackup({
      cadence: "daily",
    });
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(185_000);
    expectContinuousHeartbeats(start);
    expect(activity.heartbeat).toHaveBeenLastCalledWith({ stage: "inventory" });
    gate.resolve(true);
    await expect(operation).resolves.toMatchObject({ buckets: 11 });
    expect(activity.heartbeat).toHaveBeenCalledWith({
      stage: "bucket",
      bucket: "glitter-discord-corpus",
    });
    await expectTimerStopped();
  });

  test.each(["source inventory", "prior marker inventory", "prior manifest"])(
    "heartbeats beyond 180 seconds while waiting for %s after bucket progress",
    async (phase) => {
      // This is the real snapshot implementation against isolated in-memory
      // object stores. Seed a prior point so its protection manifest is read.
      await BackupSnapshot.runBackup({
        source,
        destination,
        backupBucket: "test-backup",
        policy: SEAWEEDFS_BACKUP_POLICY,
        cadence: "daily",
      });
      const gate = Promise.withResolvers<boolean>();
      const entered = Promise.withResolvers<boolean>();
      const wait = async () => {
        entered.resolve(true);
        await gate.promise;
      };
      if (phase === "source inventory") {
        const inventory = source.listObjects.bind(source);
        vi.spyOn(source, "listObjects").mockImplementation(
          async (bucket, prefix) => {
            if (bucket === "glitter-discord-corpus") await wait();
            return inventory(bucket, prefix);
          },
        );
      } else if (phase === "prior marker inventory") {
        const inventory = destination.listObjects.bind(destination);
        vi.spyOn(destination, "listObjects").mockImplementationOnce(
          async (bucket, prefix) => {
            await wait();
            return inventory(bucket, prefix);
          },
        );
      } else {
        const read = destination.getObject.bind(destination);
        vi.spyOn(destination, "getObject").mockImplementation(
          async (bucket, key, conditions) => {
            if (key.startsWith("snapshots/manifests/")) await wait();
            return read(bucket, key, conditions);
          },
        );
      }
      const operation = seaweedFsBackupActivities.runSeaweedFsBackup({
        cadence: "daily",
      });
      await entered.promise;
      const start = Date.now();
      await vi.advanceTimersByTimeAsync(185_000);
      expectContinuousHeartbeats(start);
      const latest = activity.heartbeat.mock.lastCall?.[0];
      expect(latest).toMatchObject({ stage: "bucket" });
      if (phase === "source inventory") {
        expect(latest).toEqual({
          stage: "bucket",
          bucket: "glitter-discord-corpus",
        });
      }
      gate.resolve(true);
      await expect(operation).resolves.toMatchObject({ buckets: 11 });
      expect(activity.heartbeat.mock.lastCall?.[0]).toMatchObject({
        stage: "complete",
      });
      await expectTimerStopped();
    },
  );

  test("cleans up the timer when quiet inventory fails", async () => {
    const gate = Promise.withResolvers<string[]>();
    const failure = new Error("Source inventory failed");
    vi.spyOn(source, "listBuckets").mockReturnValueOnce(gate.promise);
    const operation = seaweedFsBackupActivities.runSeaweedFsBackup({
      cadence: "daily",
    });
    const rejected = expect(operation).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(185_000);
    gate.reject(failure);
    await rejected;
    await expectTimerStopped();
  });

  test("preserves copy progress and safely ignores retry byte callbacks after cancellation", async () => {
    const entered = Promise.withResolvers<boolean>();
    const result =
      Promise.withResolvers<
        Awaited<ReturnType<typeof BackupSnapshot.runBackup>>
      >();
    let retryByteCallback: (() => void) | undefined;
    vi.spyOn(BackupSnapshot, "runBackup").mockImplementationOnce((input) => {
      for (const completed of [1, 2]) {
        input.onProgress?.({
          stage: "copy",
          bucket: "glitter-discord-corpus",
          completed,
          total: 2,
        });
      }
      retryByteCallback = () =>
        input.onBytes?.({
          stage: "verify",
          bucket: "glitter-discord-corpus",
          bytes: 0,
        });
      entered.resolve(true);
      return result.promise;
    });
    const operation = seaweedFsBackupActivities.runSeaweedFsBackup({
      cadence: "daily",
    });
    const failure = new Error("Activity cancelled while copying");
    const rejected = expect(operation).rejects.toBe(failure);
    await entered.promise;
    for (const completed of [1, 2]) {
      expect(activity.heartbeat).toHaveBeenCalledWith({
        stage: "copy",
        bucket: "glitter-discord-corpus",
        completed,
        total: 2,
      });
    }
    activity.cancellation.abort(failure);
    if (retryByteCallback === undefined)
      throw new Error("Missing copy retry callback");
    expect(retryByteCallback).not.toThrow();
    result.reject(failure);
    await rejected;
    await expectTimerStopped();
  });

  test.each(["Activity cancellation", "heartbeat rejection"])(
    "uses the existing store signal contract during inventory on %s",
    async (cause) => {
      const entered = Promise.withResolvers<boolean>();
      const failure = new Error(cause);
      vi.spyOn(source, "listBuckets").mockImplementationOnce(() => {
        const signal = execution?.signal;
        if (signal === undefined)
          throw new Error("Missing existing store abort signal");
        entered.resolve(true);
        return new Promise<string[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(failure), {
            once: true,
          });
        });
      });
      const operation = seaweedFsBackupActivities.runSeaweedFsBackup({
        cadence: "daily",
      });
      const rejected = expect(operation).rejects.toBe(failure);
      await entered.promise;
      if (cause === "Activity cancellation") {
        activity.cancellation.abort(failure);
      } else {
        activity.heartbeat.mockImplementationOnce(() => {
          throw failure;
        });
        await vi.advanceTimersByTimeAsync(30_000);
      }
      await rejected;
      expect(execution?.signal?.reason).toBe(failure);
      expect(await destination.listObjects("test-backup")).toEqual([]);
      await expectTimerStopped();
    },
  );
});
