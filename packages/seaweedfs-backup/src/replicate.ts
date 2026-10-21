import {
  type CopyAttemptState,
  withTransientObjectStoreRetries,
} from "./backup-object.ts";
import type { ManifestEntry } from "./schemas.ts";
import { copyChangedObject, type BackupByteProgress } from "./snapshot.ts";
import type { ObjectStore } from "./store.ts";

export type ReplicateObjectInput = {
  source: ObjectStore;
  destination: ObjectStore;
  backupBucket: string;
  sourceBucket: string;
  sourceKey: string;
  /** Hex SHA-256 the caller already holds for the source bytes. */
  expectedSha256: string;
  onBytes?: (progress: BackupByteProgress) => void;
  delay?: (milliseconds: number) => Promise<void>;
};

/**
 * Copy one object into the snapshot layout ahead of the next scheduled
 * snapshot. The copy takes the opaque key a snapshot would choose, so the next
 * daily run reuses it and its manifests reference the same bytes.
 */
export async function replicateObject(
  input: ReplicateObjectInput,
): Promise<ManifestEntry> {
  const sourceObject = await input.source.headObject(
    input.sourceBucket,
    input.sourceKey,
  );
  if (sourceObject === undefined) {
    throw new Error(
      `Replication source ${input.sourceBucket}/${input.sourceKey} does not exist`,
    );
  }
  const attemptState: CopyAttemptState = { uploaded: false };
  const result = await withTransientObjectStoreRetries(
    () =>
      copyChangedObject({
        source: input.source,
        destination: input.destination,
        backupBucket: input.backupBucket,
        sourceBucket: input.sourceBucket,
        sourceObject,
        attemptState,
        ...(input.onBytes === undefined ? {} : { onBytes: input.onBytes }),
      }),
    () =>
      input.onBytes?.({
        stage: "verify",
        bucket: input.sourceBucket,
        bytes: 0,
      }),
    input.delay,
    () => `replicate ${input.sourceBucket}/${input.sourceKey}`,
  );
  if (result.entry.sha256 !== input.expectedSha256) {
    throw new Error(
      `Replicated ${input.sourceBucket}/${input.sourceKey} has sha256 ${result.entry.sha256} but the expected digest is ${input.expectedSha256}`,
    );
  }
  return result.entry;
}
