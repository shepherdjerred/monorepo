import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { getManifest } from "@shepherdjerred/seaweedfs-backup/manifest";
import { replicateObject } from "@shepherdjerred/seaweedfs-backup/replicate";
import {
  BackupPolicySchema,
  ManifestEntrySchema,
} from "@shepherdjerred/seaweedfs-backup/schemas";
import {
  opaqueObjectKey,
  runBackup,
} from "@shepherdjerred/seaweedfs-backup/snapshot";
import {
  readObjectBytes,
  type PutObjectInput,
} from "@shepherdjerred/seaweedfs-backup/store";
import { InMemoryObjectStore } from "./in-memory-store.ts";

const SOURCE_BUCKET = "delivery-artifacts";
const SOURCE_KEY = "sites/sjer.red/build-7.tar";
const CONTENT = "immutable archive bytes";
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
      name: SOURCE_BUCKET,
      mode: "protected",
      cadences: ["daily"],
      excludeSuffixes: [],
      reason: "fixture",
    },
  ],
});

class CountingPutStore extends InMemoryObjectStore {
  public putCalls = 0;

  public override putObject(input: PutObjectInput): Promise<void> {
    this.putCalls += 1;
    return super.putObject(input);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stores(): { source: InMemoryObjectStore; backup: CountingPutStore } {
  const source = new InMemoryObjectStore();
  const backup = new CountingPutStore();
  source.createBucket(SOURCE_BUCKET);
  backup.createBucket("backup");
  source.seed(SOURCE_BUCKET, SOURCE_KEY, CONTENT);
  return { source, backup };
}

function replicate(
  source: InMemoryObjectStore,
  backup: CountingPutStore,
  expectedSha256 = sha256(CONTENT),
) {
  return replicateObject({
    source,
    destination: backup,
    backupBucket: "backup",
    sourceBucket: SOURCE_BUCKET,
    sourceKey: SOURCE_KEY,
    expectedSha256,
    delay: () => Promise.resolve(),
  });
}

describe("replicateObject", () => {
  test("copies a fresh object to the snapshot key so the next snapshot reuses it", async () => {
    const { source, backup } = stores();
    const progress: string[] = [];
    const entry = await replicateObject({
      source,
      destination: backup,
      backupBucket: "backup",
      sourceBucket: SOURCE_BUCKET,
      sourceKey: SOURCE_KEY,
      expectedSha256: sha256(CONTENT),
      onBytes: (update) => progress.push(update.stage),
    });
    const listed = await source.headObject(SOURCE_BUCKET, SOURCE_KEY);
    if (listed === undefined) throw new Error("Missing seeded source object");
    expect(ManifestEntrySchema.parse(entry)).toEqual(entry);
    expect(entry).toMatchObject({
      sourceBucket: SOURCE_BUCKET,
      sourceKey: SOURCE_KEY,
      sourceSize: CONTENT.length,
      backupObjectKey: opaqueObjectKey(SOURCE_BUCKET, listed),
      sha256: sha256(CONTENT),
    });
    expect(progress).toContain("copy");
    expect(progress).toContain("verify");
    expect(backup.putCalls).toBe(1);
    expect(
      new TextDecoder().decode(
        await readObjectBytes(
          await backup.getObject("backup", entry.backupObjectKey),
        ),
      ),
    ).toBe(CONTENT);

    const snapshot = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
      delay: () => Promise.resolve(),
    });
    expect(snapshot.buckets[0]).toMatchObject({
      objectCount: 1,
      copiedObjects: 0,
      reusedObjects: 1,
      copiedBytes: 0,
    });
    const manifest = snapshot.marker.manifests[0];
    if (manifest === undefined) throw new Error("Missing bucket manifest");
    await expect(
      getManifest(backup, "backup", manifest.key, manifest.sha256),
    ).resolves.toEqual([entry]);
    // The snapshot wrote only its manifest and completion marker.
    expect(backup.putCalls).toBe(3);
  });

  test("reuses an identical destination object without uploading again", async () => {
    const { source, backup } = stores();
    const first = await replicate(source, backup);
    expect(backup.putCalls).toBe(1);
    const second = await replicate(source, backup);
    expect(backup.putCalls).toBe(1);
    expect(second).toEqual(first);
  });

  test("rejects bytes whose digest differs from the expected digest and names both", async () => {
    const { source, backup } = stores();
    const expected = "0".repeat(64);
    await expect(replicate(source, backup, expected)).rejects.toThrow(
      `has sha256 ${sha256(CONTENT)} but the expected digest is ${expected}`,
    );
  });

  test("rejects a missing source object", async () => {
    const { source, backup } = stores();
    await expect(
      replicateObject({
        source,
        destination: backup,
        backupBucket: "backup",
        sourceBucket: SOURCE_BUCKET,
        sourceKey: "sites/missing.tar",
        expectedSha256: sha256(CONTENT),
      }),
    ).rejects.toThrow("delivery-artifacts/sites/missing.tar does not exist");
    expect(backup.putCalls).toBe(0);
  });
});
