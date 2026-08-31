import { createHash, randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CompletionMarkerSchema,
  type BackupCadence,
  type BackupPolicy,
  type BucketPolicy,
  type CompletionMarker,
  type ManifestEntry,
} from "./schemas.ts";
import {
  getManifest,
  listCompletionMarkers,
  manifestKey,
  putCompletionMarker,
  putManifest,
} from "./manifest.ts";
import {
  evaluateCoverage,
  objectIsProtected,
  policyForCadence,
} from "./policy.ts";
import type { ListedObject, ObjectStore, StoredObject } from "./store.ts";

export type SnapshotBucketResult = {
  bucket: string;
  sourceBytes: number;
  objectCount: number;
  protectedBytes: number;
  copiedObjects: number;
  reusedObjects: number;
  copiedBytes: number;
  durationSeconds: number;
};

export type BackupProgress =
  | { stage: "inventory" }
  | { stage: "bucket"; bucket: string }
  | { stage: "copy"; bucket: string; completed: number; total: number }
  | { stage: "verify"; bucket: string; completed: number; total: number }
  | { stage: "complete"; snapshotId: string };

export type BackupByteProgress = {
  stage: "copy" | "verify";
  bucket: string;
  bytes: number;
};

export type RunBackupInput = {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
  cadence: BackupCadence;
  now?: Date;
  onProgress?: (progress: BackupProgress) => void;
  onBytes?: (progress: BackupByteProgress) => void;
};

type CopyResult = {
  entry: ManifestEntry;
  copied: boolean;
};

function makeSnapshotId(now: Date): string {
  const timestamp = now.toISOString().replaceAll(/[-:]/g, "");
  return `${timestamp}-${randomBytes(6).toString("hex")}`;
}

function identityMatches(entry: ManifestEntry, object: ListedObject): boolean {
  return (
    entry.sourceSize === object.size &&
    entry.sourceEtag === object.etag &&
    entry.sourceLastModified === object.lastModified.toISOString()
  );
}

function opaqueObjectKey(bucket: string, object: ListedObject): string {
  return `objects/${createHash("sha256")
    .update(bucket)
    .update("\0")
    .update(object.key)
    .update("\0")
    .update(object.etag)
    .update("\0")
    .update(String(object.size))
    .update("\0")
    .update(object.lastModified.toISOString())
    .digest("hex")}`;
}

async function hashStream(
  object: StoredObject,
  onBytes?: (bytes: number) => void,
): Promise<{
  sha256: string;
  bytes: number;
}> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of object.body) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new TypeError("Object stream emitted an unsupported chunk type");
    }
    const value =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    hash.update(value);
    bytes += value.byteLength;
    onBytes?.(bytes);
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function copyChangedObject(input: {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  sourceBucket: string;
  sourceObject: ListedObject;
  onBytes?: (progress: BackupByteProgress) => void;
}): Promise<CopyResult> {
  const source = await input.source.getObject(
    input.sourceBucket,
    input.sourceObject.key,
    {
      etag: input.sourceObject.etag,
      unmodifiedSince: input.sourceObject.lastModified,
    },
  );
  const backupObjectKey = opaqueObjectKey(
    input.sourceBucket,
    input.sourceObject,
  );
  const existing = await input.destination.headObject(
    input.backupBucket,
    backupObjectKey,
  );
  if (existing !== undefined) {
    const destination = await input.destination.getObject(
      input.backupBucket,
      backupObjectKey,
    );
    const [sourceHash, destinationHash] = await Promise.all([
      hashStream(source, (bytes) =>
        input.onBytes?.({
          stage: "verify",
          bucket: input.sourceBucket,
          bytes,
        }),
      ),
      hashStream(destination, (bytes) =>
        input.onBytes?.({
          stage: "verify",
          bucket: input.sourceBucket,
          bytes,
        }),
      ),
    ]);
    if (
      sourceHash.bytes !== input.sourceObject.size ||
      destinationHash.bytes !== input.sourceObject.size ||
      destinationHash.sha256 !== sourceHash.sha256
    ) {
      throw new Error(
        `Existing immutable R2 object failed verification while backing up ${input.sourceBucket}`,
      );
    }
    return {
      copied: false,
      entry: {
        schemaVersion: 1,
        sourceBucket: input.sourceBucket,
        sourceKey: input.sourceObject.key,
        sourceSize: input.sourceObject.size,
        sourceEtag: input.sourceObject.etag,
        sourceLastModified: input.sourceObject.lastModified.toISOString(),
        backupObjectKey,
        sha256: sourceHash.sha256,
        headers: source.headers,
      },
    };
  }
  const hash = createHash("sha256");
  let copiedBytes = 0;
  const hashingStream = new Transform({
    transform(chunk: unknown, _encoding, callback) {
      if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
        callback(
          new TypeError("Object stream emitted an unsupported chunk type"),
        );
        return;
      }
      const value =
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      hash.update(value);
      copiedBytes += value.byteLength;
      input.onBytes?.({
        stage: "copy",
        bucket: input.sourceBucket,
        bytes: copiedBytes,
      });
      callback(undefined, value);
    },
  });
  const upload = input.destination.putObject({
    bucket: input.backupBucket,
    key: backupObjectKey,
    body: hashingStream,
    contentLength: input.sourceObject.size,
    headers: source.headers,
  });
  await Promise.all([pipeline(source.body, hashingStream), upload]);
  if (copiedBytes !== input.sourceObject.size) {
    throw new Error(
      `Conditional source read changed size while backing up ${input.sourceBucket}`,
    );
  }
  const sha256 = hash.digest("hex");
  const verification = await hashStream(
    await input.destination.getObject(input.backupBucket, backupObjectKey),
    (bytes) =>
      input.onBytes?.({
        stage: "verify",
        bucket: input.sourceBucket,
        bytes,
      }),
  );
  if (
    verification.bytes !== input.sourceObject.size ||
    verification.sha256 !== sha256
  ) {
    throw new Error(
      `R2 read-back verification failed while backing up ${input.sourceBucket}`,
    );
  }
  return {
    copied: true,
    entry: {
      schemaVersion: 1,
      sourceBucket: input.sourceBucket,
      sourceKey: input.sourceObject.key,
      sourceSize: input.sourceObject.size,
      sourceEtag: input.sourceObject.etag,
      sourceLastModified: input.sourceObject.lastModified.toISOString(),
      backupObjectKey,
      sha256,
      headers: source.headers,
    },
  };
}

async function previousEntriesForBucket(
  store: ObjectStore,
  backupBucket: string,
  bucket: string,
): Promise<Map<string, ManifestEntry>> {
  const markers = await listCompletionMarkers(store, backupBucket);
  for (const marker of markers) {
    const descriptor = marker.manifests.find(
      (manifest) => manifest.bucket === bucket,
    );
    if (descriptor !== undefined) {
      const entries = await getManifest(
        store,
        backupBucket,
        descriptor.key,
        descriptor.sha256,
      );
      return new Map(entries.map((entry) => [entry.sourceKey, entry]));
    }
  }
  return new Map();
}

async function backupSourceBucket(input: {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  snapshotId: string;
  bucketPolicy: BucketPolicy;
  onProgress?: (progress: BackupProgress) => void;
  onBytes?: (progress: BackupByteProgress) => void;
}): Promise<{ entries: ManifestEntry[]; result: SnapshotBucketResult }> {
  const startedAt = performance.now();
  input.onProgress?.({ stage: "bucket", bucket: input.bucketPolicy.name });
  const [sourceObjects, previous] = await Promise.all([
    input.source.listObjects(input.bucketPolicy.name),
    previousEntriesForBucket(
      input.destination,
      input.backupBucket,
      input.bucketPolicy.name,
    ),
  ]);
  const protectedObjects = sourceObjects.filter((object) =>
    objectIsProtected(object.key, input.bucketPolicy),
  );
  const entries: ManifestEntry[] = [];
  let copiedObjects = 0;
  let reusedObjects = 0;
  let copiedBytes = 0;
  for (const [index, object] of protectedObjects.entries()) {
    const prior = previous.get(object.key);
    let result: CopyResult;
    if (prior !== undefined && identityMatches(prior, object)) {
      result = { entry: prior, copied: false };
      reusedObjects += 1;
    } else {
      result = await copyChangedObject({
        source: input.source,
        destination: input.destination,
        backupBucket: input.backupBucket,
        sourceBucket: input.bucketPolicy.name,
        sourceObject: object,
        ...(input.onBytes === undefined ? {} : { onBytes: input.onBytes }),
      });
      if (result.copied) {
        copiedObjects += 1;
        copiedBytes += object.size;
      } else {
        reusedObjects += 1;
      }
    }
    entries.push(result.entry);
    input.onProgress?.({
      stage: result.copied ? "verify" : "copy",
      bucket: input.bucketPolicy.name,
      completed: index + 1,
      total: protectedObjects.length,
    });
  }
  entries.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return {
    entries,
    result: {
      bucket: input.bucketPolicy.name,
      sourceBytes: sourceObjects.reduce(
        (total, object) => total + object.size,
        0,
      ),
      objectCount: entries.length,
      protectedBytes: entries.reduce(
        (total, entry) => total + entry.sourceSize,
        0,
      ),
      copiedObjects,
      reusedObjects,
      copiedBytes,
      durationSeconds: (performance.now() - startedAt) / 1000,
    },
  };
}

export async function runBackup(input: RunBackupInput): Promise<{
  marker: CompletionMarker;
  buckets: SnapshotBucketResult[];
}> {
  const startedAt = input.now ?? new Date();
  const snapshotId = makeSnapshotId(startedAt);
  input.onProgress?.({ stage: "inventory" });
  const coverage = evaluateCoverage(
    await input.source.listBuckets(),
    input.policy,
  );
  if (coverage.unclassified.length > 0) {
    throw new Error(
      `SeaweedFS backup policy does not classify ${String(coverage.unclassified.length)} live bucket(s)`,
    );
  }
  if (coverage.missingProtected.length > 0) {
    throw new Error(
      `SeaweedFS is missing ${String(coverage.missingProtected.length)} protected bucket(s)`,
    );
  }
  const manifests: CompletionMarker["manifests"] = [];
  const results: SnapshotBucketResult[] = [];
  for (const bucketPolicy of policyForCadence(input.policy, input.cadence)) {
    const backedUp = await backupSourceBucket({
      source: input.source,
      destination: input.destination,
      backupBucket: input.backupBucket,
      snapshotId,
      bucketPolicy,
      ...(input.onProgress === undefined
        ? {}
        : { onProgress: input.onProgress }),
      ...(input.onBytes === undefined ? {} : { onBytes: input.onBytes }),
    });
    const key = manifestKey(snapshotId, bucketPolicy.name);
    const sha256 = await putManifest(
      input.destination,
      input.backupBucket,
      key,
      backedUp.entries,
    );
    await getManifest(input.destination, input.backupBucket, key, sha256);
    manifests.push({ ...backedUp.result, key, sha256 });
    results.push(backedUp.result);
  }
  const marker = CompletionMarkerSchema.parse({
    schemaVersion: 1,
    snapshotId,
    cadence: input.cadence,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    manifests,
  });
  await putCompletionMarker(input.destination, input.backupBucket, marker);
  input.onProgress?.({ stage: "complete", snapshotId });
  return { marker, buckets: results };
}
