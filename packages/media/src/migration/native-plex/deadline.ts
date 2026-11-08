import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import type { NativePlexProofParent } from "#shared/plex-binding/native.ts";
import type {
  ApprovedStorageRoot,
  CanonicalMountEvidence,
} from "#shared/canonical-storage.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import {
  assertWritersQuiescent,
  assertCanonicalIdentity,
} from "#migration/native-network/evidence.ts";

/** Original invocation clocks bind all consumed DB evidence; refreshed rows cannot extend it. */
export async function nativePlexDeadline(
  tx: Prisma.TransactionClient,
  input: {
    execution: PlexBindingExecution;
    recoveryEpoch: number;
    previous?: PlexBindingFreshness;
  },
) {
  const { execution, recoveryEpoch, previous } = input;
  execution.assertActive();
  previous?.assertActive();
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const storage = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    orderBy: { rootPath: "asc" },
  });
  if (storage.length !== 2)
    throw new PlexBindingProtection("ownership_changed");
  const deadlines = [
    execution.expiresAtMs,
    ...(previous === undefined ? [] : [previous.expiresAtMs]),
  ];
  for (const row of [lease, ...storage]) {
    if (
      row.recoveryEpoch !== recoveryEpoch ||
      row.revokedAt !== null ||
      row.observedAt.getTime() > Date.now() ||
      row.expiresAt.getTime() <= Date.now() ||
      row.expiresAt.getTime() - row.observedAt.getTime() > 120_000
    )
      throw new PlexBindingProtection("ownership_changed");
    deadlines.push(row.expiresAt.getTime());
  }
  return exclusionDeadline(tx, execution, deadlines, previous);
}

/** Review prepares the grant; old-epoch storage is provenance, never serving authority. */
export async function nativeReviewPlexDeadline(
  tx: Prisma.TransactionClient,
  input: {
    parent: Extract<NativePlexProofParent, { purpose: "native_review" }>;
    execution: PlexBindingExecution;
    previous: PlexBindingFreshness;
    quiescence: QuiescenceEvidence;
    mounts: CanonicalMountEvidence;
    roots: ApprovedStorageRoot[];
  },
) {
  const { parent, execution, previous, quiescence, mounts, roots } = input;
  assertReviewParent(parent);
  execution.assertActive();
  previous.assertActive();
  assertWritersQuiescent(quiescence);
  assertCanonicalIdentity(mounts, roots);
  const lease = await tx.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  const storage = await tx.mediaStorageAuthority.findMany({
    where: { rootPath: { in: roots.map((root) => root.rootPath) } },
  });
  if (storage.length !== roots.length)
    throw new PlexBindingProtection("ownership_changed");
  for (const row of [...(lease === null ? [] : [lease]), ...storage]) {
    const capturedAt = Date.parse(
      "rootPath" in row ? mounts.capturedAt : quiescence.capturedAt,
    );
    if (
      row.recoveryEpoch > parent.recoveryEpoch ||
      (row.recoveryEpoch === parent.recoveryEpoch &&
        row.revokedAt !== null &&
        Math.max(row.observedAt.getTime(), row.revokedAt.getTime()) >=
          capturedAt)
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  if (
    lease?.recoveryEpoch === parent.recoveryEpoch &&
    lease.observedAt.getTime() >= Date.parse(quiescence.capturedAt) &&
    (lease.configurationDigest !== quiescence.configurationDigest ||
      lease.targetsDigest !== quiescence.targetsDigest)
  )
    throw new PlexBindingProtection("ownership_changed");
  for (const root of roots) {
    const row = storage.find((value) => value.rootPath === root.rootPath);
    if (
      row?.pvcUid !== root.pvcUid ||
      row.volumeName !== root.volumeName ||
      row.volumePath !== root.volumePath
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  return exclusionDeadline(
    tx,
    execution,
    [
      execution.expiresAtMs,
      previous.expiresAtMs,
      Date.parse(quiescence.expiresAt),
      Date.parse(mounts.expiresAt),
    ],
    previous,
  );
}

function assertReviewParent(parent: NativePlexProofParent) {
  if (parent.purpose !== "native_review")
    throw new Error("Native review deadline received execution parent");
}

async function exclusionDeadline(
  tx: Prisma.TransactionClient,
  execution: PlexBindingExecution,
  deadlines: number[],
  previous?: PlexBindingFreshness,
) {
  for (const library of ["/data/movies", "/data/tv"]) {
    const proof = await requirePlexExclusionDatabaseProof(tx, {
      library,
      control: `${library}/.media-control`,
    });
    deadlines.push(
      Date.parse(
        z.object({ topologyCheckedAt: z.iso.datetime() }).parse(proof.evidence)
          .topologyCheckedAt,
      ) + 900_000,
    );
  }
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(...deadlines),
    guards: [execution, ...(previous === undefined ? [] : [previous])],
  });
  freshness.assertActive();
  return freshness;
}
