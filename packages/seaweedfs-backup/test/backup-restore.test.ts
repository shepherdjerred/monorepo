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

describe("incremental backup and restore", () => {
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

  test("restores metadata and verifies all checksums", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
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
    expect(restored.headers.metadata).toEqual({ fixture: "true" });
  });
});
