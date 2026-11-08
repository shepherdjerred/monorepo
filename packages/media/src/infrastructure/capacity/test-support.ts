import type { Database } from "#infrastructure/database.ts";
import { canonicalFixture } from "#integrations/legacy-observer/canonical-fixture.ts";
import { observeCanonicalMounts } from "#integrations/legacy-observer/canonical-mounts.ts";
import {
  CapacityBindingSchema,
  CAPACITY_ROLES,
  CAPACITY_ROOTS,
} from "#shared/capacity/contract.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PrismaCapacityAdministration } from "./service.ts";

export async function capacityRows(now: number, epoch = 0) {
  const source = canonicalFixture();
  const evidence = await observeCanonicalMounts({
    request: source.request,
    signal: AbortSignal.timeout(5000),
    now: () => now,
  });
  return CAPACITY_ROLES.map((role) => {
    const mount = evidence.mounts.find(
      (item) => item.root === CAPACITY_ROOTS[role],
    );
    if (mount === undefined) throw new Error("Fixture canonical mount missing");
    const binding = CapacityBindingSchema.parse({
      schemaVersion: 1,
      role,
      rootPath: mount.root,
      pvcUid: mount.pvcUid,
      volumeName: mount.volumeName,
      volumePath: mount.volumePath,
      workerPodUid: mount.podUid,
      recoveryEpoch: epoch,
    });
    const bindingDigest = snapshotHash(binding);
    const date = new Date(now);
    return {
      role,
      cycleRevision: 1n,
      cycleEpoch: epoch,
      cycleStartedAt: date,
      mountResultRevision: 1n,
      mountOutcome: "observed",
      mountReason: null,
      mountEpoch: epoch,
      mountCompletedAt: date,
      mountObservedAt: date,
      mountExpiresAt: new Date(evidence.expiresAt),
      mountBinding: binding,
      mountBindingDigest: bindingDigest,
      mountEvidence: evidence,
      sampleAttempt: 1n,
      sampleAttemptCycle: 1n,
      sampleAttemptStartedAt: date,
      sampleResultAttempt: 1n,
      sampleOutcome: "observed",
      sampleReason: null,
      sampleEpoch: epoch,
      sampleStartedAt: date,
      sampleObservedAt: date,
      sampleCompletedAt: date,
      sampleBinding: binding,
      sampleBindingDigest: bindingDigest,
      sampleIdentity: { device: "1", inode: "2" },
      totalBytes: 9_007_199_254_740_993n,
      availableBytes: 0n,
    };
  });
}

export async function capacityFixture(db: Database, now = Date.now()) {
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", recoveryEpoch: 0, ownershipConfirmed: false },
  });
  await db.mediaCapacityObservation.deleteMany();
  const rows = await capacityRows(now);
  await db.mediaCapacityObservation.createMany({ data: rows });
  const actor = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Capacity owner",
      role: "owner",
    },
  });
  return {
    actor,
    rows,
    now,
    service: new PrismaCapacityAdministration(db, () => Promise.resolve(true)),
  };
}
