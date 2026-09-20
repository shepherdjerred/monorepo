import { describe, expect, test } from "vitest";
import { listCompletionMarkers } from "@shepherdjerred/seaweedfs-backup/manifest";
import { restoreSnapshot } from "@shepherdjerred/seaweedfs-backup/restore";
import { BackupPolicySchema } from "@shepherdjerred/seaweedfs-backup/schemas";
import { runBackup } from "@shepherdjerred/seaweedfs-backup/snapshot";
import { verifySnapshot } from "@shepherdjerred/seaweedfs-backup/verify";
import { InMemoryObjectStore } from "./in-memory-store.ts";

const POLICY = BackupPolicySchema.parse({
  version: 1,
  retention: {
    sixHourly: 28,
    daily: 30,
    weekly: 8,
    monthly: 12,
    candidateMinimumAgeDays: 35,
    candidateDelayDays: 7,
    objectLockDays: 30,
  },
  buckets: [
    {
      name: "source",
      mode: "protected",
      cadences: ["daily"],
      excludeSuffixes: [".png"],
      reason: "fixture",
    },
  ],
});

function stores(): {
  source: InMemoryObjectStore;
  backup: InMemoryObjectStore;
} {
  const source = new InMemoryObjectStore();
  const backup = new InMemoryObjectStore();
  source.createBucket("source");
  backup.createBucket("backup");
  return { source, backup };
}

class DelayedHeadStore extends InMemoryObjectStore {
  public activeHeads = 0;
  public failFirstHead = false;
  public headCalls = 0;
  public maximumActiveHeads = 0;

  public override async headObject(bucket: string, key: string) {
    this.headCalls += 1;
    const call = this.headCalls;
    this.activeHeads += 1;
    this.maximumActiveHeads = Math.max(
      this.maximumActiveHeads,
      this.activeHeads,
    );
    try {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, call === 1 && this.failFirstHead ? 1 : 10),
      );
      if (call === 1 && this.failFirstHead) {
        throw new Error("Injected head failure");
      }
      return await super.headObject(bucket, key);
    } finally {
      this.activeHeads -= 1;
    }
  }
}

class MutatingSourceStore extends InMemoryObjectStore {
  private mutated = false;

  public override async listObjects(bucket: string, prefix = "") {
    const listed = await super.listObjects(bucket, prefix);
    if (bucket === "source" && !this.mutated) {
      this.mutated = true;
      this.seed(
        "source",
        "state.json",
        "after",
        new Date("2026-08-02T00:00:00.000Z"),
      );
    }
    return listed;
  }
}

function concurrencyStores(backup = new DelayedHeadStore()): {
  source: InMemoryObjectStore;
  backup: DelayedHeadStore;
} {
  const source = new InMemoryObjectStore();
  source.createBucket("source");
  backup.createBucket("backup");
  for (let index = 0; index < 40; index++) {
    source.seed("source", `object-${index.toString()}.json`, "important");
  }
  return { source, backup };
}

function takeConcurrencySnapshot(
  source: InMemoryObjectStore,
  backup: DelayedHeadStore,
  onCompleted?: (completed: number) => void,
) {
  return runBackup({
    source,
    destination: backup,
    backupBucket: "backup",
    policy: POLICY,
    cadence: "daily",
    onProgress(update) {
      if (update.stage === "copy" || update.stage === "verify") {
        onCompleted?.(update.completed);
      }
    },
  });
}

function resetHeadTracking(
  backup: DelayedHeadStore,
  failFirstHead = false,
): void {
  backup.headCalls = 0;
  backup.maximumActiveHeads = 0;
  backup.failFirstHead = failFirstHead;
}

describe("object concurrency", () => {
  test("copies objects with bounded concurrency", async () => {
    const { source, backup } = concurrencyStores();
    const progress: number[] = [];
    const snapshot = await takeConcurrencySnapshot(
      source,
      backup,
      (completed) => progress.push(completed),
    );

    expect(backup.maximumActiveHeads).toBeGreaterThan(1);
    expect(backup.maximumActiveHeads).toBeLessThanOrEqual(16);
    expect(progress).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(snapshot.buckets[0]).toMatchObject({
      objectCount: 40,
      copiedObjects: 40,
    });
  });

  test("drains in-flight work and stops claiming objects after a failure", async () => {
    const backup = new DelayedHeadStore();
    backup.failFirstHead = true;
    const { source } = concurrencyStores(backup);

    await expect(takeConcurrencySnapshot(source, backup)).rejects.toThrow(
      "Injected head failure",
    );

    expect(backup.activeHeads).toBe(0);
    expect(backup.headCalls).toBeLessThanOrEqual(16);
    await expect(listCompletionMarkers(backup, "backup")).resolves.toEqual([]);
  });

  test("verifies objects with bounded concurrency", async () => {
    const { source, backup } = concurrencyStores();
    const snapshot = await takeConcurrencySnapshot(source, backup);
    resetHeadTracking(backup);

    await expect(
      verifySnapshot({
        store: backup,
        backupBucket: "backup",
        snapshotId: snapshot.marker.snapshotId,
        full: true,
      }),
    ).resolves.toMatchObject({ checkedObjects: 40, hashedObjects: 40 });
    expect(backup.maximumActiveHeads).toBeGreaterThan(1);
    expect(backup.maximumActiveHeads).toBeLessThanOrEqual(16);
  });

  test("drains a failed verification batch before rejecting", async () => {
    const { source, backup } = concurrencyStores();
    const snapshot = await takeConcurrencySnapshot(source, backup);
    resetHeadTracking(backup, true);

    await expect(
      verifySnapshot({
        store: backup,
        backupBucket: "backup",
        snapshotId: snapshot.marker.snapshotId,
        full: true,
      }),
    ).rejects.toThrow("Injected head failure");
    expect(backup.activeHeads).toBe(0);
    expect(backup.headCalls).toBeLessThanOrEqual(16);
  });
});

describe("destination visibility", () => {
  test("retries a newly uploaded object that is briefly not visible", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    backup.unavailableReadsAfterPut = 1;
    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).resolves.toMatchObject({ buckets: [{ copiedObjects: 1 }] });
  });
});

describe("incremental backup and restore", () => {
  test("refreshes a source object that changes after inventory", async () => {
    const source = new MutatingSourceStore();
    const backup = new InMemoryObjectStore();
    source.createBucket("source");
    backup.createBucket("backup");
    source.seed("source", "state.json", "before");

    const snapshot = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
    });
    const current = await source.headObject("source", "state.json");

    expect(snapshot.buckets[0]).toMatchObject({
      objectCount: 1,
      copiedObjects: 1,
      copiedBytes: 5,
    });
    expect(snapshot.marker.manifests[0]).toMatchObject({ protectedBytes: 5 });
    expect(current).toBeDefined();
    await expect(
      verifySnapshot({
        store: backup,
        backupBucket: "backup",
        snapshotId: snapshot.marker.snapshotId,
        full: true,
      }),
    ).resolves.toMatchObject({ checkedObjects: 1, hashedObjects: 1 });
  });

  test("reuses unchanged objects and keeps deleted versions recoverable", async () => {
    const { source, backup } = stores();
    source.seed("source", "résumé.json", "first");
    source.seed("source", "derived.png", "ignored");
    const first = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(first.buckets[0]).toMatchObject({
      objectCount: 1,
      copiedObjects: 1,
      reusedObjects: 0,
    });
    const second = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      now: new Date("2026-08-02T12:00:00.000Z"),
    });
    expect(second.buckets[0]).toMatchObject({
      objectCount: 1,
      copiedObjects: 0,
      reusedObjects: 1,
    });
    await source.deleteObject("source", "résumé.json");
    await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      now: new Date("2026-08-03T12:00:00.000Z"),
    });
    await expect(
      verifySnapshot({
        store: backup,
        backupBucket: "backup",
        snapshotId: first.marker.snapshotId,
        full: true,
      }),
    ).resolves.toMatchObject({ checkedObjects: 1, hashedObjects: 1 });
  });

  test("does not publish a completion marker after read-back corruption", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    backup.corruptWrites = true;
    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).rejects.toThrow("read-back verification failed");
    await expect(listCompletionMarkers(backup, "backup")).resolves.toEqual([]);
  });

  test("resumes after an object upload without overwriting the immutable object", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    backup.failPutPrefix = "snapshots/manifests/";
    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).rejects.toThrow("Injected put failure");

    backup.failPutPrefix = undefined;
    const resumed = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
    });
    expect(resumed.buckets[0]).toMatchObject({
      copiedObjects: 0,
      reusedObjects: 1,
      copiedBytes: 0,
    });
  });

  test("refuses production and non-empty restore destinations", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    const snapshot = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
    });
    await expect(
      restoreSnapshot({
        backupStore: backup,
        destinationStore: source,
        backupBucket: "backup",
        destinationBucket: "source",
        sourceBucket: "source",
        snapshotId: snapshot.marker.snapshotId,
        policy: POLICY,
      }),
    ).rejects.toThrow("production bucket");

    const restore = new InMemoryObjectStore();
    restore.createBucket("restore-empty");
    restore.seed("restore-empty", "existing", "data");
    await expect(
      restoreSnapshot({
        backupStore: backup,
        destinationStore: restore,
        backupBucket: "backup",
        destinationBucket: "restore-empty",
        sourceBucket: "source",
        snapshotId: snapshot.marker.snapshotId,
        policy: POLICY,
      }),
    ).rejects.toThrow("must be empty");
  });
});

describe("metadata preservation", () => {
  test("stores opaque payloads and restores source metadata", async () => {
    const { source, backup } = stores();
    source.seedWithHeaders({
      bucket: "source",
      key: "state.json",
      value: "important",
      headers: {
        contentType: "application/json",
        metadata: { trackedplayers: "Jérred" },
      },
    });
    const snapshot = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
    });
    const restore = new InMemoryObjectStore();
    restore.createBucket("acceptance-restore");
    await expect(
      restoreSnapshot({
        backupStore: backup,
        destinationStore: restore,
        backupBucket: "backup",
        destinationBucket: "acceptance-restore",
        sourceBucket: "source",
        snapshotId: snapshot.marker.snapshotId,
        policy: POLICY,
      }),
    ).resolves.toEqual({ restoredObjects: 1, restoredBytes: 9 });
    const restored = await restore.getObject(
      "acceptance-restore",
      "state.json",
    );
    expect(restored.headers).toEqual({
      contentType: "application/json",
      metadata: { trackedplayers: "Jérred" },
    });
    const backupObjects = await backup.listObjects("backup");
    const payload = backupObjects.find((object) =>
      object.key.startsWith("objects/"),
    );
    expect(payload).toBeDefined();
    if (payload === undefined) throw new Error("Missing backup payload");
    const storedPayload = await backup.getObject("backup", payload.key);
    expect(storedPayload.headers).toEqual({
      contentType: "application/octet-stream",
      metadata: {},
    });
  });
});
