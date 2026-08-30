import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BackupPolicy } from "./schemas.ts";
import { getManifest } from "./manifest.ts";
import type { ObjectStore } from "./store.ts";
import { findCompletionMarker } from "./verify.ts";

export async function restoreSnapshot(input: {
  backupStore: ObjectStore;
  destinationStore: ObjectStore;
  backupBucket: string;
  destinationBucket: string;
  sourceBucket: string;
  snapshotId: string;
  policy: BackupPolicy;
}): Promise<{ restoredObjects: number; restoredBytes: number }> {
  const forbidden = new Set([
    input.backupBucket,
    ...input.policy.buckets.map((bucket) => bucket.name),
  ]);
  if (forbidden.has(input.destinationBucket)) {
    throw new Error("Restore destination must not be a production bucket");
  }
  const existing = await input.destinationStore.listObjects(
    input.destinationBucket,
  );
  if (existing.length > 0) {
    throw new Error("Restore destination bucket must be empty");
  }
  const marker = await findCompletionMarker(
    input.backupStore,
    input.backupBucket,
    input.snapshotId,
  );
  const descriptor = marker.manifests.find(
    (manifest) => manifest.bucket === input.sourceBucket,
  );
  if (descriptor === undefined) {
    throw new Error(
      `Snapshot ${input.snapshotId} does not contain ${input.sourceBucket}`,
    );
  }
  const entries = await getManifest(
    input.backupStore,
    input.backupBucket,
    descriptor.key,
    descriptor.sha256,
  );
  let restoredBytes = 0;
  for (const entry of entries) {
    const source = await input.backupStore.getObject(
      input.backupBucket,
      entry.backupObjectKey,
    );
    const hash = createHash("sha256");
    const hashingStream = new Transform({
      transform(chunk: unknown, _encoding, callback) {
        if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
          callback(
            new TypeError("Object stream emitted an unsupported chunk type"),
          );
          return;
        }
        hash.update(chunk);
        callback(undefined, chunk);
      },
    });
    const upload = input.destinationStore.putObject({
      bucket: input.destinationBucket,
      key: entry.sourceKey,
      body: hashingStream,
      contentLength: entry.sourceSize,
      headers: entry.headers,
    });
    await Promise.all([pipeline(source.body, hashingStream), upload]);
    if (hash.digest("hex") !== entry.sha256) {
      throw new Error(
        `Restore transfer checksum mismatch for ${input.sourceBucket}`,
      );
    }
    const restored = await input.destinationStore.getObject(
      input.destinationBucket,
      entry.sourceKey,
    );
    const readbackHash = createHash("sha256");
    for await (const chunk of restored.body) {
      if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
        throw new TypeError("Object stream emitted an unsupported chunk type");
      }
      readbackHash.update(chunk);
    }
    if (readbackHash.digest("hex") !== entry.sha256) {
      throw new Error(
        `Restored object checksum mismatch for ${input.sourceBucket}`,
      );
    }
    restoredBytes += entry.sourceSize;
  }
  return { restoredObjects: entries.length, restoredBytes };
}
