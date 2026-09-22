import { createHash, randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import {
  type CopyAttemptState,
  type CopyResult,
  getConditionalSourceObject,
  getUploadedObject,
  hashStoredObject,
  hashStoredObjectPair,
  uploadOpaqueObject,
  withTransientObjectStoreRetries,
} from "./backup-object.ts";
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
  delay?: (milliseconds: number) => Promise<void>;
};

// Object storage round trips dominate this path. Keeping a small fixed pool
// makes a six-figure bucket finish inside the Activity timeout while bounding
// open source/R2 streams and multipart uploads on the single backup worker.
const OBJECT_CONCURRENCY = 16;
const SOURCE_VERSION_ATTEMPTS = 3;

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

async function copyChangedObject(input: {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  sourceBucket: string;
  sourceObject: ListedObject;
  attemptState: CopyAttemptState;
  onBytes?: (progress: BackupByteProgress) => void;
}): Promise<CopyResult> {
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
    let source: StoredObject;
    try {
      source = await getConditionalSourceObject(input);
    } catch (error: unknown) {
      destination.body.destroy();
      throw error;
    }
    const hashes = await hashStoredObjectPair({
      source,
      destination,
      onSourceBytes: (bytes) =>
        input.onBytes?.({ stage: "verify", bucket: input.sourceBucket, bytes }),
      onDestinationBytes: (bytes) =>
        input.onBytes?.({ stage: "verify", bucket: input.sourceBucket, bytes }),
    });
    if (
      hashes.source.bytes !== input.sourceObject.size ||
      hashes.destination.bytes !== input.sourceObject.size ||
      hashes.destination.sha256 !== hashes.source.sha256
    ) {
      throw new Error(
        `Existing immutable R2 object failed verification while backing up ${input.sourceBucket}`,
      );
    }
    return {
      copied: input.attemptState.uploaded,
      entry: {
        schemaVersion: 1,
        sourceBucket: input.sourceBucket,
        sourceKey: input.sourceObject.key,
        sourceSize: input.sourceObject.size,
        sourceEtag: input.sourceObject.etag,
        sourceLastModified: input.sourceObject.lastModified.toISOString(),
        backupObjectKey,
        sha256: hashes.source.sha256,
        headers: source.headers,
      },
    };
  }
  const source = await getConditionalSourceObject(input);
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
  await uploadOpaqueObject({
    destination: input.destination,
    backupBucket: input.backupBucket,
    backupObjectKey,
    sourceBody: source.body,
    hashingStream,
    contentLength: input.sourceObject.size,
  });
  input.attemptState.uploaded = true;
  if (copiedBytes !== input.sourceObject.size) {
    throw new Error(
      `Conditional source read changed size while backing up ${input.sourceBucket}`,
    );
  }
  const sha256 = hash.digest("hex");
  const verification = await hashStoredObject(
    await getUploadedObject({
      destination: input.destination,
      backupBucket: input.backupBucket,
      backupObjectKey,
    }),
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

async function copyWithSourceVersionRefresh(input: {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  sourceBucket: string;
  sourceObject: ListedObject;
  prior: ManifestEntry | undefined;
  attemptState: CopyAttemptState;
  onBytes?: (progress: BackupByteProgress) => void;
}): Promise<CopyResult> {
  let sourceObject = input.sourceObject;
  for (let attempt = 1; attempt <= SOURCE_VERSION_ATTEMPTS; attempt += 1) {
    if (
      input.prior !== undefined &&
      identityMatches(input.prior, sourceObject)
    ) {
      return { entry: input.prior, copied: false };
    }
    try {
      return await copyChangedObject({
        source: input.source,
        destination: input.destination,
        backupBucket: input.backupBucket,
        sourceBucket: input.sourceBucket,
        sourceObject,
        attemptState: input.attemptState,
        ...(input.onBytes === undefined ? {} : { onBytes: input.onBytes }),
      });
    } catch (error: unknown) {
      const preconditionFailed =
        error instanceof Error &&
        (error.name === "PreconditionFailed" ||
          error.message === "PreconditionFailed" ||
          error.message.includes("pre-conditions you specified did not hold"));
      if (!preconditionFailed || attempt === SOURCE_VERSION_ATTEMPTS) {
        throw error;
      }
      const refreshed = await input.source.headObject(
        input.sourceBucket,
        sourceObject.key,
      );
      if (refreshed === undefined) {
        throw new Error(
          `Source object disappeared while backing up ${input.sourceBucket}`,
          { cause: error },
        );
      }
      sourceObject = refreshed;
    }
  }
  throw new Error("Source version retry loop exited unexpectedly");
}

async function runObjectWorkers(
  objects: readonly ListedObject[],
  task: (object: ListedObject) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const state: { stopped: boolean; failure: unknown } = {
    stopped: false,
    failure: undefined,
  };
  const worker = async (): Promise<void> => {
    while (!state.stopped && nextIndex < objects.length) {
      const index = nextIndex;
      nextIndex += 1;
      const object = objects[index];
      if (object === undefined) {
        state.stopped = true;
        state.failure = new Error(
          "Backup object cursor exceeded the inventory",
        );
        return;
      }
      try {
        await task(object);
      } catch (error: unknown) {
        state.failure = error;
        state.stopped = true;
        return;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(OBJECT_CONCURRENCY, objects.length) },
      worker,
    ),
  );
  if (state.stopped) {
    throw state.failure;
  }
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
  delay: (milliseconds: number) => Promise<void>;
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
  let completed = 0;
  await runObjectWorkers(protectedObjects, async (object) => {
    const attemptState: CopyAttemptState = { uploaded: false };
    const result = await withTransientObjectStoreRetries(
      () =>
        copyWithSourceVersionRefresh({
          source: input.source,
          destination: input.destination,
          backupBucket: input.backupBucket,
          sourceBucket: input.bucketPolicy.name,
          sourceObject: object,
          prior: previous.get(object.key),
          attemptState,
          ...(input.onBytes === undefined ? {} : { onBytes: input.onBytes }),
        }),
      () =>
        input.onBytes?.({
          stage: "verify",
          bucket: input.bucketPolicy.name,
          bytes: 0,
        }),
      input.delay,
      () => `copy ${input.bucketPolicy.name}/${object.key}`,
    );
    copiedObjects += result.copied ? 1 : 0;
    reusedObjects += result.copied ? 0 : 1;
    copiedBytes += result.copied ? result.entry.sourceSize : 0;
    entries.push(result.entry);
    completed += 1;
    input.onProgress?.({
      stage: result.copied ? "verify" : "copy",
      bucket: input.bucketPolicy.name,
      completed,
      total: protectedObjects.length,
    });
  });
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
      delay: input.delay ?? ((milliseconds) => Bun.sleep(milliseconds)),
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
