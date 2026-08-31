import { gzipSync, gunzipSync } from "node:zlib";
import {
  GcCandidateSetSchema,
  type BackupPolicy,
  type GcCandidateSet,
} from "./schemas.ts";
import { getManifest, listCompletionMarkers } from "./manifest.ts";
import type { ObjectStore } from "./store.ts";
import { readObjectBytes } from "./store.ts";
import { selectRetainedSnapshotIds } from "./retention.ts";

const DAY_MILLISECONDS = 86_400_000;

async function earliestCandidateObservations(input: {
  store: ObjectStore;
  backupBucket: string;
}): Promise<Map<string, string>> {
  const observations = new Map<string, string>();
  for (const object of await input.store.listObjects(
    input.backupBucket,
    "gc/candidates/",
  )) {
    const candidateSet = await readCandidateSet(
      input.store,
      input.backupBucket,
      object.key,
    );
    for (const candidate of candidateSet.candidates) {
      const previous = observations.get(candidate.objectKey);
      if (
        previous === undefined ||
        Date.parse(candidate.firstObservedUnreferencedAt) < Date.parse(previous)
      ) {
        observations.set(
          candidate.objectKey,
          candidate.firstObservedUnreferencedAt,
        );
      }
    }
  }
  return observations;
}

async function retainedProtectionSet(input: {
  store: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
}): Promise<Set<string>> {
  const markers = await listCompletionMarkers(input.store, input.backupBucket);
  const retained = selectRetainedSnapshotIds(markers, input.policy);
  const protectedObjects = new Set<string>();
  for (const marker of markers) {
    if (!retained.has(marker.snapshotId)) continue;
    for (const descriptor of marker.manifests) {
      const entries = await getManifest(
        input.store,
        input.backupBucket,
        descriptor.key,
        descriptor.sha256,
      );
      for (const entry of entries) {
        protectedObjects.add(entry.backupObjectKey);
      }
    }
  }
  return protectedObjects;
}

export async function createGcCandidateSet(input: {
  store: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
  now?: Date;
  priorObservations?: ReadonlyMap<string, string>;
}): Promise<{ key: string; candidateCount: number }> {
  const now = input.now ?? new Date();
  const protectedObjects = await retainedProtectionSet(input);
  const previousObservations =
    input.priorObservations ?? (await earliestCandidateObservations(input));
  const objects = await input.store.listObjects(input.backupBucket, "objects/");
  const candidateSet = GcCandidateSetSchema.parse({
    schemaVersion: 1,
    createdAt: now.toISOString(),
    candidates: objects
      .filter((object) => !protectedObjects.has(object.key))
      .map((object) => ({
        schemaVersion: 1,
        objectKey: object.key,
        objectLastModified: object.lastModified.toISOString(),
        firstObservedUnreferencedAt:
          previousObservations.get(object.key) ?? now.toISOString(),
      })),
  });
  const key = `gc/candidates/${now.toISOString().replaceAll(/[-:]/g, "")}.json.gz`;
  const bytes = gzipSync(
    new TextEncoder().encode(JSON.stringify(candidateSet)),
    { level: 9 },
  );
  await input.store.putObject({
    bucket: input.backupBucket,
    key,
    body: bytes,
    contentLength: bytes.byteLength,
    headers: {
      contentType: "application/json",
      contentEncoding: "gzip",
      metadata: {},
    },
  });
  return { key, candidateCount: candidateSet.candidates.length };
}

async function readCandidateSet(
  store: ObjectStore,
  backupBucket: string,
  key: string,
): Promise<GcCandidateSet> {
  const bytes = await readObjectBytes(await store.getObject(backupBucket, key));
  return GcCandidateSetSchema.parse(
    JSON.parse(new TextDecoder().decode(gunzipSync(bytes))),
  );
}

export async function sweepGcCandidates(input: {
  store: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
  candidateKey: string;
  now?: Date;
}): Promise<{ deleted: number; retained: number }> {
  const now = input.now ?? new Date();
  const candidateSet = await readCandidateSet(
    input.store,
    input.backupBucket,
    input.candidateKey,
  );
  const delay = input.policy.retention.candidateDelayDays * DAY_MILLISECONDS;
  if (now.getTime() - Date.parse(candidateSet.createdAt) < delay) {
    throw new Error("GC candidate set has not completed its safety delay");
  }
  const protectedObjects = await retainedProtectionSet(input);
  let deleted = 0;
  let retained = 0;
  for (const candidate of candidateSet.candidates) {
    if (protectedObjects.has(candidate.objectKey)) {
      retained += 1;
      continue;
    }
    const head = await input.store.headObject(
      input.backupBucket,
      candidate.objectKey,
    );
    if (head === undefined) continue;
    if (head.lastModified.toISOString() !== candidate.objectLastModified) {
      retained += 1;
      continue;
    }
    const unreferencedAge =
      now.getTime() - Date.parse(candidate.firstObservedUnreferencedAt);
    if (
      unreferencedAge <
      input.policy.retention.candidateMinimumAgeDays * DAY_MILLISECONDS
    ) {
      retained += 1;
      continue;
    }
    const ageDays =
      (now.getTime() - head.lastModified.getTime()) / DAY_MILLISECONDS;
    if (ageDays < input.policy.retention.objectLockDays) {
      retained += 1;
      continue;
    }
    await input.store.deleteObject(input.backupBucket, candidate.objectKey);
    deleted += 1;
  }
  return { deleted, retained };
}

export async function runGcCycle(input: {
  store: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
  now?: Date;
}): Promise<{
  candidateCount: number;
  candidateBacklog: number;
  deleted: number;
  retained: number;
  oldestPendingTimestampSeconds: number;
}> {
  const now = input.now ?? new Date();
  const candidateObjects = await input.store.listObjects(
    input.backupBucket,
    "gc/candidates/",
  );
  let deleted = 0;
  let retained = 0;
  let processed = 0;
  const previousObservations = await earliestCandidateObservations(input);
  const pendingCreatedAt: number[] = [];
  const delayMilliseconds =
    input.policy.retention.candidateDelayDays * DAY_MILLISECONDS;
  for (const object of candidateObjects) {
    const candidateSet = await readCandidateSet(
      input.store,
      input.backupBucket,
      object.key,
    );
    if (
      now.getTime() - Date.parse(candidateSet.createdAt) <
      delayMilliseconds
    ) {
      pendingCreatedAt.push(Date.parse(candidateSet.createdAt));
      continue;
    }
    const result = await sweepGcCandidates({
      store: input.store,
      backupBucket: input.backupBucket,
      policy: input.policy,
      candidateKey: object.key,
      now,
    });
    deleted += result.deleted;
    retained += result.retained;
    processed += 1;
    await input.store.deleteObject(input.backupBucket, object.key);
  }
  const created = await createGcCandidateSet({
    ...input,
    priorObservations: previousObservations,
  });
  pendingCreatedAt.push(now.getTime());
  return {
    candidateCount: created.candidateCount,
    candidateBacklog: candidateObjects.length - processed + 1,
    deleted,
    retained,
    oldestPendingTimestampSeconds: Math.min(...pendingCreatedAt) / 1000,
  };
}
