import { describe, expect, test, vi } from "vitest";
import {
  createGcCandidateSet,
  sweepGcCandidates,
  runGcCycle,
  readGcInventory,
} from "@shepherdjerred/seaweedfs-backup/gc";
import {
  manifestKey,
  putCompletionMarker,
  putManifest,
} from "@shepherdjerred/seaweedfs-backup/manifest";
import { BackupPolicySchema } from "@shepherdjerred/seaweedfs-backup/schemas";
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
      excludeSuffixes: [],
      reason: "fixture",
    },
  ],
});

async function candidateFixture() {
  const store = new InMemoryObjectStore();
  store.createBucket("backup");
  const keys = [
    `objects/${"a".repeat(64)}`,
    `objects/${"b".repeat(64)}`,
  ] as const;
  for (const key of keys) {
    store.seed("backup", key, "payload", new Date("2025-11-01"));
  }
  const candidates = await createGcCandidateSet({
    store,
    backupBucket: "backup",
    policy: POLICY,
    now: new Date("2026-01-01"),
  });
  return { store, keys, candidateKey: candidates.key };
}

async function protectObject(store: InMemoryObjectStore, objectKey: string) {
  const snapshotId = "20260102T000000.000Z-aaaaaaaaaaaa";
  const key = manifestKey(snapshotId, "source");
  const sha256 = await putManifest(store, "backup", key, [
    {
      schemaVersion: 1,
      sourceBucket: "source",
      sourceKey: "state.json",
      sourceSize: 9,
      sourceEtag: '"fixture"',
      sourceLastModified: "2025-11-01T00:00:00.000Z",
      backupObjectKey: objectKey,
      sha256: "b".repeat(64),
      headers: { metadata: {} },
    },
  ]);
  await putCompletionMarker(store, "backup", {
    schemaVersion: 1,
    snapshotId,
    cadence: "daily",
    startedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T01:00:00.000Z",
    manifests: [
      {
        bucket: "source",
        key,
        sha256,
        objectCount: 1,
        sourceBytes: 9,
        protectedBytes: 9,
        copiedObjects: 1,
        reusedObjects: 0,
        copiedBytes: 9,
        durationSeconds: 1,
      },
    ],
  });
  return key;
}

describe("read-only pending GC inventory", () => {
  test("reports no pending sets only after a successful empty listing", async () => {
    const store = new InMemoryObjectStore();
    store.createBucket("backup");
    await expect(
      readGcInventory({ store, backupBucket: "backup" }),
    ).resolves.toEqual({
      candidateBacklog: 0,
      candidateCount: 0,
      oldestPendingTimestampSeconds: 0,
    });
  });

  test("uses persisted set creation time and newest contents without deletion or publication", async () => {
    const { store, keys } = await candidateFixture();
    await protectObject(store, keys[0]);
    await createGcCandidateSet({
      store,
      backupBucket: "backup",
      policy: POLICY,
      now: new Date("2026-01-03"),
    });
    const remove = vi.spyOn(store, "deleteObject");
    const write = vi.spyOn(store, "putObject");
    await expect(
      readGcInventory({ store, backupBucket: "backup" }),
    ).resolves.toEqual({
      candidateBacklog: 2,
      candidateCount: 1,
      oldestPendingTimestampSeconds: Date.parse("2026-01-01") / 1000,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test("rejects unreadable candidate sets instead of reporting an empty healthy backlog", async () => {
    const { store, candidateKey } = await candidateFixture();
    store.seed("backup", candidateKey, "invalid gzip");
    await expect(
      readGcInventory({ store, backupBucket: "backup" }),
    ).rejects.toThrow();
  });

  test("propagates listing failure instead of reporting zero candidates", async () => {
    const { store } = await candidateFixture();
    vi.spyOn(store, "listObjects").mockRejectedValue(
      new Error("Inventory unavailable"),
    );
    await expect(
      readGcInventory({ store, backupBucket: "backup" }),
    ).rejects.toThrow("Inventory unavailable");
  });
});

describe("two-phase garbage collection", () => {
  test("fails closed if a retained protection manifest is unreadable", async () => {
    const { store, keys, candidateKey } = await candidateFixture();
    const manifest = await protectObject(store, keys[0]);
    store.seed("backup", manifest, "invalid gzip");
    const deletion = vi.spyOn(store, "deleteObject");
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-02-08"),
      }),
    ).rejects.toThrow();
    expect(deletion).not.toHaveBeenCalled();
  });

  test("retains an object still inside its lock period despite old prior observations", async () => {
    const store = new InMemoryObjectStore();
    store.createBucket("backup");
    const key = `objects/${"a".repeat(64)}`;
    store.seed("backup", key, "recently uploaded", new Date("2026-02-01"));
    const candidates = await createGcCandidateSet({
      store,
      backupBucket: "backup",
      policy: POLICY,
      now: new Date("2026-02-02"),
      priorObservations: new Map([[key, "2025-11-01T00:00:00.000Z"]]),
    });
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey: candidates.key,
        now: new Date("2026-02-10"),
      }),
    ).resolves.toEqual({ deleted: 0, retained: 1 });
  });

  test("does not delete after cancellation during object revalidation", async () => {
    const { store, keys, candidateKey } = await candidateFixture();
    const cancellation = new AbortController();
    const head = store.headObject.bind(store);
    vi.spyOn(store, "headObject").mockImplementation(async (bucket, key) => {
      const result = await head(bucket, key);
      cancellation.abort(new Error("Activity expired"));
      return result;
    });
    const deletion = vi.spyOn(store, "deleteObject");
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-02-08"),
        hooks: { signal: cancellation.signal },
      }),
    ).rejects.toThrow("Activity expired");
    expect(deletion).not.toHaveBeenCalled();
    expect(await head("backup", keys[0])).toBeDefined();
  });

  test("stops between deletes and keeps the candidate set retryable", async () => {
    const { store, keys, candidateKey } = await candidateFixture();
    const cancellation = new AbortController();
    const remove = store.deleteObject.bind(store);
    const deletion = vi
      .spyOn(store, "deleteObject")
      .mockImplementation(async (bucket, key) => {
        await remove(bucket, key);
        cancellation.abort(new Error("Cancelled after first delete"));
      });
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-02-08"),
        hooks: { signal: cancellation.signal },
      }),
    ).rejects.toThrow("Cancelled after first delete");
    expect(deletion).toHaveBeenCalledTimes(1);
    expect(await store.headObject("backup", keys[1])).toBeDefined();
    expect(await store.headObject("backup", candidateKey)).toBeDefined();
    deletion.mockRestore();
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-02-08"),
      }),
    ).resolves.toEqual({ deleted: 1, retained: 0 });
  });

  test("retains changed and insufficiently aged candidates", async () => {
    const { store, keys, candidateKey } = await candidateFixture();
    store.seed("backup", keys[0], "changed", new Date("2026-01-02"));
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-01-09"),
      }),
    ).resolves.toEqual({ deleted: 0, retained: 2 });
  });

  test("rejects candidate sets before the delay and an already cancelled run", async () => {
    const { store, candidateKey } = await candidateFixture();
    const deletion = vi.spyOn(store, "deleteObject");
    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey,
        now: new Date("2026-01-02"),
      }),
    ).rejects.toThrow("safety delay");
    await expect(
      runGcCycle({
        store,
        backupBucket: "backup",
        policy: POLICY,
        hooks: { signal: AbortSignal.abort(new Error("Already cancelled")) },
      }),
    ).rejects.toThrow("Already cancelled");
    expect(deletion).not.toHaveBeenCalled();
  });

  test("keeps a candidate that becomes referenced before revalidation", async () => {
    const store = new InMemoryObjectStore();
    store.createBucket("backup");
    store.seed(
      "backup",
      `objects/${"a".repeat(64)}`,
      "important",
      new Date("2025-11-01T00:00:00.000Z"),
    );
    const candidates = await createGcCandidateSet({
      store,
      backupBucket: "backup",
      policy: POLICY,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(candidates.candidateCount).toBe(1);

    await protectObject(store, `objects/${"a".repeat(64)}`);

    await expect(
      sweepGcCandidates({
        store,
        backupBucket: "backup",
        policy: POLICY,
        candidateKey: candidates.key,
        now: new Date("2026-01-09T00:00:01.000Z"),
      }),
    ).resolves.toEqual({ deleted: 0, retained: 1 });
    await expect(
      store.headObject("backup", `objects/${"a".repeat(64)}`),
    ).resolves.toBeDefined();
  });
});
