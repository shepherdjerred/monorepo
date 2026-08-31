import { describe, expect, test } from "vitest";
import {
  createGcCandidateSet,
  sweepGcCandidates,
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

describe("two-phase garbage collection", () => {
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
        backupObjectKey: `objects/${"a".repeat(64)}`,
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
