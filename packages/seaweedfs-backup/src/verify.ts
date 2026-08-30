import { createHash } from "node:crypto";
import { getManifest, listCompletionMarkers } from "./manifest.ts";
import type { CompletionMarker, ManifestEntry } from "./schemas.ts";
import type { ObjectStore } from "./store.ts";

export type VerificationResult = {
  snapshotId: string;
  manifests: number;
  checkedObjects: number;
  hashedObjects: number;
};

async function sha256Object(
  store: ObjectStore,
  bucket: string,
  entry: ManifestEntry,
): Promise<string> {
  const object = await store.getObject(bucket, entry.backupObjectKey);
  const hash = createHash("sha256");
  for await (const chunk of object.body) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new TypeError("Object stream emitted an unsupported chunk type");
    }
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function shouldHash(entry: ManifestEntry, full: boolean): boolean {
  return full || Number.parseInt(entry.sha256.slice(0, 8), 16) % 100 === 0;
}

export async function findCompletionMarker(
  store: ObjectStore,
  backupBucket: string,
  snapshotId: string,
): Promise<CompletionMarker> {
  const markers = await listCompletionMarkers(store, backupBucket);
  const marker = markers.find(
    (candidate) => candidate.snapshotId === snapshotId,
  );
  if (marker === undefined) {
    throw new Error(`Completed snapshot ${snapshotId} does not exist`);
  }
  return marker;
}

async function verifyEntry(input: {
  store: ObjectStore;
  backupBucket: string;
  bucket: string;
  entry: ManifestEntry;
  hash: boolean;
}): Promise<boolean> {
  const head = await input.store.headObject(
    input.backupBucket,
    input.entry.backupObjectKey,
  );
  if (head?.size !== input.entry.sourceSize) {
    throw new Error(
      `Missing or incorrectly sized backup object in ${input.bucket}`,
    );
  }
  if (!input.hash) return false;
  const sha256 = await sha256Object(
    input.store,
    input.backupBucket,
    input.entry,
  );
  if (sha256 !== input.entry.sha256) {
    throw new Error(`Backup object checksum mismatch in ${input.bucket}`);
  }
  return true;
}

async function verifyManifest(input: {
  store: ObjectStore;
  backupBucket: string;
  descriptor: CompletionMarker["manifests"][number];
  full: boolean;
}): Promise<{ checked: number; hashed: number }> {
  const entries = await getManifest(
    input.store,
    input.backupBucket,
    input.descriptor.key,
    input.descriptor.sha256,
  );
  if (entries.length !== input.descriptor.objectCount) {
    throw new Error(
      `Manifest object count mismatch for ${input.descriptor.bucket}`,
    );
  }
  let hashed = 0;
  for (const entry of entries) {
    if (
      await verifyEntry({
        store: input.store,
        backupBucket: input.backupBucket,
        bucket: input.descriptor.bucket,
        entry,
        hash: shouldHash(entry, input.full),
      })
    ) {
      hashed += 1;
    }
  }
  const first = entries[0];
  if (first !== undefined && hashed === 0 && !input.full) {
    await verifyEntry({
      store: input.store,
      backupBucket: input.backupBucket,
      bucket: input.descriptor.bucket,
      entry: first,
      hash: true,
    });
    hashed = 1;
  }
  return { checked: entries.length, hashed };
}

export async function verifySnapshot(input: {
  store: ObjectStore;
  backupBucket: string;
  snapshotId: string;
  full: boolean;
}): Promise<VerificationResult> {
  const marker = await findCompletionMarker(
    input.store,
    input.backupBucket,
    input.snapshotId,
  );
  let checkedObjects = 0;
  let hashedObjects = 0;
  for (const descriptor of marker.manifests) {
    const verified = await verifyManifest({
      store: input.store,
      backupBucket: input.backupBucket,
      descriptor,
      full: input.full,
    });
    checkedObjects += verified.checked;
    hashedObjects += verified.hashed;
  }
  return {
    snapshotId: marker.snapshotId,
    manifests: marker.manifests.length,
    checkedObjects,
    hashedObjects,
  };
}
