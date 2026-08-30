import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { listCompletionMarkers } from "@shepherdjerred/seaweedfs-backup/manifest";
import { restoreSnapshot } from "@shepherdjerred/seaweedfs-backup/restore";
import { BackupPolicySchema } from "@shepherdjerred/seaweedfs-backup/schemas";
import { runBackup } from "@shepherdjerred/seaweedfs-backup/snapshot";
import {
  createS3ObjectStore,
  type GetObjectConditions,
  type ListedObject,
  type ObjectStore,
  type PutObjectInput,
  type StoredObject,
} from "@shepherdjerred/seaweedfs-backup/store";

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

class FailingManifestStore implements ObjectStore {
  public constructor(private readonly delegate: ObjectStore) {}

  public listBuckets(): Promise<string[]> {
    return this.delegate.listBuckets();
  }

  public listObjects(bucket: string, prefix?: string): Promise<ListedObject[]> {
    return this.delegate.listObjects(bucket, prefix);
  }

  public getObject(
    bucket: string,
    key: string,
    conditions?: GetObjectConditions,
  ): Promise<StoredObject> {
    return this.delegate.getObject(bucket, key, conditions);
  }

  public headObject(
    bucket: string,
    key: string,
  ): Promise<ListedObject | undefined> {
    return this.delegate.headObject(bucket, key);
  }

  public putObject(input: PutObjectInput): Promise<void> {
    if (input.key.startsWith("snapshots/manifests/")) {
      throw new Error("Injected manifest interruption");
    }
    return this.delegate.putObject(input);
  }

  public deleteObject(bucket: string, key: string): Promise<void> {
    return this.delegate.deleteObject(bucket, key);
  }
}

async function startServer(
  directory: string,
  buckets: readonly string[],
): Promise<{ process: ChildProcessWithoutNullStreams; port: number }> {
  const serverProcess = spawn(
    "node",
    [
      new URL("s3rver-fixture.mjs", import.meta.url).pathname,
      directory,
      ...buckets,
    ],
    { stdio: "pipe" },
  );
  const output = await once(serverProcess.stdout, "data");
  const firstChunk = output[0];
  if (!(firstChunk instanceof Uint8Array)) {
    throw new TypeError("S3 test server returned invalid startup output");
  }
  const port = Number(new TextDecoder().decode(firstChunk).trim());
  if (!Number.isInteger(port) || port < 1) {
    throw new Error("S3 test server did not report a valid port");
  }
  return { process: serverProcess, port };
}

describe("two S3-compatible endpoints", () => {
  let sourceServer: ChildProcessWithoutNullStreams;
  let backupServer: ChildProcessWithoutNullStreams;
  let sourceDirectory: string;
  let backupDirectory: string;
  let source: ObjectStore;
  let backup: ObjectStore;

  beforeAll(async () => {
    sourceDirectory = await mkdtemp(path.join(tmpdir(), "seaweedfs-source-"));
    backupDirectory = await mkdtemp(path.join(tmpdir(), "seaweedfs-backup-"));
    const [sourceStarted, backupStarted] = await Promise.all([
      startServer(sourceDirectory, ["source"]),
      startServer(backupDirectory, ["backup"]),
    ]);
    sourceServer = sourceStarted.process;
    backupServer = backupStarted.process;
    source = createS3ObjectStore({
      endpoint: `http://127.0.0.1:${String(sourceStarted.port)}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
    });
    backup = createS3ObjectStore({
      endpoint: `http://127.0.0.1:${String(backupStarted.port)}`,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
    });
  });

  afterAll(async () => {
    const closed = Promise.all([
      once(sourceServer, "close"),
      once(backupServer, "close"),
    ]);
    sourceServer.kill("SIGKILL");
    backupServer.kill("SIGKILL");
    await closed;
    await Promise.all([
      rm(sourceDirectory, { recursive: true, force: true }),
      rm(backupDirectory, { recursive: true, force: true }),
    ]);
  });

  test("streams multipart data, resumes interruption, and restores metadata", async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024 + 17);
    bytes.fill(42);
    await source.putObject({
      bucket: "source",
      key: "large résumé.bin",
      body: Readable.from([bytes]),
      contentLength: bytes.byteLength,
      headers: {
        contentType: "application/octet-stream",
        cacheControl: "private, max-age=60",
        metadata: { fixture: "multipart" },
      },
    });
    const metadataBytes = new TextEncoder().encode("metadata");
    await source.putObject({
      bucket: "source",
      key: "metadata.json",
      body: metadataBytes,
      contentLength: metadataBytes.byteLength,
      headers: {
        contentType: "application/json",
        cacheControl: "private, max-age=60",
        metadata: { fixture: "headers" },
      },
    });

    await expect(
      runBackup({
        source,
        destination: new FailingManifestStore(backup),
        backupBucket: "backup",
        policy: POLICY,
        cadence: "daily",
      }),
    ).rejects.toThrow("Injected manifest interruption");
    await expect(listCompletionMarkers(backup, "backup")).resolves.toEqual([]);

    const resumed = await runBackup({
      source,
      destination: backup,
      backupBucket: "backup",
      policy: POLICY,
      cadence: "daily",
    });
    expect(resumed.buckets[0]).toMatchObject({
      copiedObjects: 0,
      reusedObjects: 2,
    });

    await mkdir(path.join(sourceDirectory, "restore"));
    await expect(
      restoreSnapshot({
        backupStore: backup,
        destinationStore: source,
        backupBucket: "backup",
        destinationBucket: "restore",
        sourceBucket: "source",
        snapshotId: resumed.marker.snapshotId,
        policy: POLICY,
      }),
    ).resolves.toEqual({
      restoredObjects: 2,
      restoredBytes: bytes.byteLength + metadataBytes.byteLength,
    });
    const restored = await source.getObject("restore", "metadata.json");
    expect(restored.headers).toMatchObject({
      contentType: "application/json",
      cacheControl: "private, max-age=60",
      metadata: { fixture: "headers" },
    });
  }, 30_000);
});
