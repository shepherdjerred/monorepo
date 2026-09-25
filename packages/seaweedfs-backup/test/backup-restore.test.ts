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

class CountingSourceStore extends InMemoryObjectStore {
  public getCalls = 0;

  public override getObject(
    ...input: Parameters<InMemoryObjectStore["getObject"]>
  ) {
    this.getCalls += 1;
    return super.getObject(...input);
  }
}

class RetryingHeadStore extends InMemoryObjectStore {
  public transientHeadFailures = 0;

  public override async headObject(
    ...input: Parameters<InMemoryObjectStore["headObject"]>
  ) {
    if (this.transientHeadFailures > 0) {
      this.transientHeadFailures -= 1;
      const error = new Error("connect ECONNREFUSED 10.0.0.1:8333");
      Object.defineProperty(error, "code", { value: "ECONNREFUSED" });
      throw error;
    }
    return super.headObject(...input);
  }
}

class TransientErrorSourceStore extends InMemoryObjectStore {
  public nextError: Error | undefined;

  public override getObject(
    ...input: Parameters<InMemoryObjectStore["getObject"]>
  ) {
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
    return super.getObject(...input);
  }
}

async function retrySourceError(
  error: Error,
): Promise<TransientErrorSourceStore> {
  const source = new TransientErrorSourceStore();
  const backup = new InMemoryObjectStore();
  source.createBucket("source");
  backup.createBucket("backup");
  source.seed("source", "state.json", "important");
  source.nextError = error;
  await expect(
    runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      delay: () => Promise.resolve(),
    }),
  ).resolves.toMatchObject({ buckets: [{ copiedObjects: 1 }] });
  return source;
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

describe("transient object-store failures", () => {
  test("retries an AbortError regardless of its message", async () => {
    const error = new Error("S3 request cancelled by peer");
    error.name = "AbortError";
    const source = await retrySourceError(error);
    expect(source.nextError).toBeUndefined();
  });

  test("retries contextual socket hang-up errors", async () => {
    const source = await retrySourceError(
      new Error("request failed: socket hang up"),
    );
    expect(source.nextError).toBeUndefined();
  });

  test("does not open source streams before retrying destination probes", async () => {
    const source = new CountingSourceStore();
    const backup = new RetryingHeadStore();
    source.createBucket("source");
    backup.createBucket("backup");
    source.seed("source", "state.json", "important");
    backup.transientHeadFailures = 1;

    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).resolves.toMatchObject({ buckets: [{ copiedObjects: 1 }] });

    expect(source.getCalls).toBe(1);
  });

  test("drains the source pipeline when an upload rejects immediately", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    backup.failPutPrefix = "objects/";
    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).rejects.toThrow("Injected put failure");
  });

  test("retries a refused source connection without restarting the backup", async () => {
    const { source, backup } = stores();
    source.seed("source", "state.json", "important");
    source.transientGetFailures = 1;
    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).resolves.toMatchObject({ buckets: [{ copiedObjects: 1 }] });
    expect(source.transientGetFailures).toBe(0);
  });

  test("preserves upload accounting and heartbeats across read-back retries", async () => {
    const { source, backup } = stores();
    const retryHeartbeats: number[] = [];
    source.seed("source", "state.json", "important");
    backup.transientGetFailures = 1;
    const result = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      onBytes(progress) {
        if (progress.bytes === 0) retryHeartbeats.push(progress.bytes);
      },
    });
    expect(result.buckets[0]).toMatchObject({
      copiedObjects: 1,
      reusedObjects: 0,
      copiedBytes: 9,
    });
    expect(retryHeartbeats).toEqual([0]);
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

describe("transport resilience", () => {
  test("a dropped connection costs one object, not the whole run", async () => {
    // A multi-hour transfer loses a connection sooner or later. Retrying the
    // whole run is what the Activity already does, and at hours-to-failure it
    // never produces a manifest — which is why no daily backup ever completed.
    const { source, backup } = stores();
    source.seed("source", "a.json", "first");
    source.seed("source", "b.json", "second");
    source.seed("source", "c.json", "third");
    source.transportFailures.set("b.json", 2);

    const delays: number[] = [];
    const result = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      now: new Date("2026-08-01T12:00:00.000Z"),
      delay: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    // Every object landed, including the one interrupted twice, and the run
    // backed off between attempts rather than hammering.
    expect(source.transportFailures.get("b.json")).toBe(0);
    expect(result.buckets[0]).toMatchObject({
      objectCount: 3,
      copiedObjects: 3,
    });
    expect(delays).toEqual([500, 1000]);
  });

  test("a connection that never recovers still fails the run", async () => {
    // Bounded, not infinite: the run must still fail rather than hang.
    const { source, backup } = stores();
    source.seed("source", "a.json", "first");
    source.transportFailures.set("a.json", Number.MAX_SAFE_INTEGER);

    await expect(
      runBackup({
        source,
        destination: backup,
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
        now: new Date("2026-08-01T12:00:00.000Z"),
        delay: () => Promise.resolve(),
      }),
    ).rejects.toThrow(
      /could not copy source\/a\.json after 12 transient transport attempts/u,
    );
  });
});
