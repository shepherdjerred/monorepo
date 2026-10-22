import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BackupPolicy } from "./schemas.ts";
import { getManifest } from "./manifest.ts";
import { isPreconditionFailed, type ObjectStore } from "./store.ts";
import { findCompletionMarker } from "./verify.ts";

export type RestoredObject = { key: string; size: number; sha256: string };

type RestoreInput = {
  backupStore: ObjectStore;
  destinationStore: ObjectStore;
  backupBucket: string;
  destinationBucket: string;
  sourceBucket: string;
  snapshotId: string;
  policy: BackupPolicy;
  /**
   * Permit restoring a production bucket from its own backup into a fresh,
   * empty SeaweedFS. Every other check still applies and nothing is overwritten.
   */
  coldStart?: boolean;
  /** Called after each object's read-back checksum has been verified. */
  onObjectRestored?: (object: RestoredObject) => Promise<void> | void;
};

function assertDestinationAllowed(input: RestoreInput): void {
  if (input.destinationBucket === input.backupBucket) {
    throw new Error("Restore destination must not be a production bucket");
  }
  const production = input.policy.buckets.some(
    (bucket) => bucket.name === input.destinationBucket,
  );
  if (!production) return;
  if (input.coldStart !== true) {
    throw new Error(
      `Restore destination must not be a production bucket: ${input.destinationBucket}. Only a cold start into an empty bucket may pass --cold-start`,
    );
  }
  if (input.destinationBucket !== input.sourceBucket) {
    throw new Error(
      `Cold-start restore must return a production bucket to itself: source ${input.sourceBucket} cannot restore into ${input.destinationBucket}`,
    );
  }
}

async function assertDestinationEmpty(input: RestoreInput): Promise<void> {
  const existing = await input.destinationStore.listObjects(
    input.destinationBucket,
  );
  if (existing.length === 0) return;
  throw new Error(
    input.coldStart === true
      ? `Restore destination bucket must be empty: cold start found ${String(existing.length)} existing object(s) in ${input.destinationBucket} (first: ${existing[0]?.key ?? "unknown"}). Cold start never overwrites or merges`
      : "Restore destination bucket must be empty",
  );
}

async function assertNotOverwriting(
  input: RestoreInput,
  key: string,
): Promise<void> {
  if (input.coldStart !== true) return;
  const present = await input.destinationStore.headObject(
    input.destinationBucket,
    key,
  );
  if (present !== undefined) throw overwriteRefusal(input, key);
}

type VerifiedObject = { size: number; etag: string; modifiedAt: number };

function comparableEtag(etag: string): string {
  return etag.replaceAll(/^"|"$/gu, "");
}

/** S3 reports modification times to the second. */
function wholeSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * The emptiness check runs once, before the first write, and each object is
 * verified right after it lands. Compare the final listing with what was
 * verified so a cold start never reports success over a bucket another
 * workload wrote to, overwrote, or deleted from while the restore ran.
 */
async function assertDestinationUnchanged(
  input: RestoreInput,
  verified: ReadonlyMap<string, VerifiedObject>,
): Promise<void> {
  if (input.coldStart !== true) return;
  const listed = await input.destinationStore.listObjects(
    input.destinationBucket,
  );
  const present = new Map(listed.map((object) => [object.key, object]));
  const stray = [...present.keys()].filter((key) => !verified.has(key));
  if (stray.length > 0) {
    throw new Error(
      `Cold-start restore found ${String(stray.length)} object(s) in ${input.destinationBucket} that are not in snapshot ${input.snapshotId} (first: ${stray[0] ?? "unknown"}). Another writer used the bucket during the restore`,
    );
  }
  const changed = [...verified].filter(([key, expected]) => {
    const actual = present.get(key);
    return (
      actual?.size !== expected.size ||
      comparableEtag(actual.etag) !== comparableEtag(expected.etag) ||
      wholeSeconds(actual.lastModified) !== expected.modifiedAt
    );
  });
  if (changed.length > 0) {
    throw new Error(
      `Cold-start restore found ${String(changed.length)} restored object(s) in ${input.destinationBucket} removed or rewritten after verification (first: ${changed[0]?.[0] ?? "unknown"}). Another writer used the bucket during the restore`,
    );
  }
}

function overwriteRefusal(input: RestoreInput, key: string): Error {
  return new Error(
    `Cold-start restore refused to overwrite ${input.destinationBucket}/${key}`,
  );
}

export async function restoreSnapshot(
  input: RestoreInput,
): Promise<{ restoredObjects: number; restoredBytes: number }> {
  assertDestinationAllowed(input);
  await assertDestinationEmpty(input);
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
  const verified = new Map<string, VerifiedObject>();
  for (const entry of entries) {
    await assertNotOverwriting(input, entry.sourceKey);
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
      // The HEAD above only refuses early. The write itself must be atomic so
      // an object created in between is never replaced.
      createOnly: input.coldStart === true,
    });
    await Promise.all([
      pipeline(source.body, hashingStream),
      upload.catch((error: unknown) => {
        throw input.coldStart === true && isPreconditionFailed(error)
          ? overwriteRefusal(input, entry.sourceKey)
          : error;
      }),
    ]);
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
    verified.set(entry.sourceKey, {
      size: restored.size,
      etag: restored.etag,
      modifiedAt: wholeSeconds(restored.lastModified),
    });
    restoredBytes += entry.sourceSize;
    await input.onObjectRestored?.({
      key: entry.sourceKey,
      size: entry.sourceSize,
      sha256: entry.sha256,
    });
  }
  await assertDestinationUnchanged(input, verified);
  return { restoredObjects: entries.length, restoredBytes };
}
