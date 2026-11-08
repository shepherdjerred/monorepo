import { z } from "zod";
import type {
  MediaRuntimeState,
  MediaStorageAuthority,
  Prisma,
} from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { createLegacyObserver } from "#integrations/legacy-observer/runtime.ts";
import {
  NativeStorageAuthoritySchema,
  CanonicalMountEvidenceSchema,
} from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { queueOwnerHealth } from "#infrastructure/notifications/owner-health.ts";
import { assertNativeStorageRoots } from "./storage-provenance.ts";

export async function refreshNativeStorageAuthorities(input: {
  db: Database;
  observer: ReturnType<typeof createLegacyObserver>;
  before: MediaRuntimeState;
  rows: MediaStorageAuthority[];
}): Promise<void> {
  let observation: ReturnType<
    typeof CanonicalMountEvidenceSchema.parse
  > | null = null;
  let prior: ReturnType<typeof NativeStorageAuthoritySchema.parse> | null =
    null;
  try {
    const parsed = input.rows.map((row) =>
      NativeStorageAuthoritySchema.parse(row.evidence),
    );
    const first = parsed[0];
    if (
      first === undefined ||
      input.rows.length !== 2 ||
      input.rows.some((row) => row.revokedAt !== null) ||
      parsed.some(
        (item) =>
          snapshotHash(item.approvedRoots) !==
          snapshotHash(first.approvedRoots),
      )
    )
      throw new Error("Native storage root provenance incomplete");
    prior = first;
    await assertNativeStorageRoots(input.db, prior.approvedRoots);
    observation = CanonicalMountEvidenceSchema.parse(
      await input.observer.observeCanonicalMounts(),
    );
  } catch {
    // Unreadable or changed authority fails closed; raw external errors are never persisted.
  }
  const proof = observation;
  const approved = prior;
  await input.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.version !== input.before.version ||
      runtime.recoveryEpoch !== input.before.recoveryEpoch ||
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed
    )
      return;
    await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" WHERE "recoveryEpoch" = ${runtime.recoveryEpoch} ORDER BY "rootPath" FOR UPDATE`;
    const current = await tx.mediaStorageAuthority.findMany({
      where: { recoveryEpoch: runtime.recoveryEpoch },
      orderBy: { rootPath: "asc" },
    });
    if (
      snapshotHash(
        current.map((row) => ({ root: row.rootPath, version: row.version })),
      ) !==
      snapshotHash(
        input.rows.map((row) => ({ root: row.rootPath, version: row.version })),
      )
    )
      return;
    await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
    const valid = await verifyRenewal(tx, { proof, approved });
    if (!valid || proof === null || approved === null) {
      await tx.mediaStorageAuthority.updateMany({
        where: { recoveryEpoch: runtime.recoveryEpoch },
        data: { revokedAt: new Date(), version: { increment: 1 } },
      });
      const revoked = await tx.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: {
          mode: "observe",
          ownershipConfirmed: false,
          version: { increment: 1 },
        },
      });
      await queueOwnerHealth(tx, {
        schemaVersion: 1,
        reason: "media_storage_authority_revoked",
        recoveryEpoch: revoked.recoveryEpoch,
        runtimeVersion: revoked.version,
        evidenceDigest: snapshotHash(z.json().parse(proof)),
      });
      return;
    }
    for (const row of current) {
      if (row.observedAt > new Date(proof.capturedAt)) continue;
      const mount = proof.mounts.find(
        (candidate) => candidate.root === row.rootPath,
      );
      if (mount === undefined) throw new Error("Native canonical root missing");
      await tx.mediaStorageAuthority.update({
        where: { rootPath: row.rootPath },
        data: {
          workerPodUid: mount.podUid,
          evidence: {
            schemaVersion: 1,
            kind: "native_restore",
            approvedRoots: approved.approvedRoots,
            mounts: proof,
          },
          observedAt: new Date(proof.capturedAt),
          expiresAt: new Date(proof.expiresAt),
          version: { increment: 1 },
        },
      });
    }
  });
}
async function verifyRenewal(
  tx: Prisma.TransactionClient,
  input: {
    proof: ReturnType<typeof CanonicalMountEvidenceSchema.parse> | null;
    approved: ReturnType<typeof NativeStorageAuthoritySchema.parse> | null;
  },
): Promise<boolean> {
  const { proof, approved } = input;
  if (proof === null || approved === null || !fresh(proof)) return false;
  const lease = await tx.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  const leaseProof = QuiescenceEvidenceSchema.safeParse(lease?.observation);
  const authority = await runtimeAuthority(tx);
  if (!authority.active || !leaseProof.success || !leaseProof.data.quiescent)
    return false;
  try {
    const roots = await assertNativeStorageRoots(tx, approved.approvedRoots);
    return roots.every((root) =>
      proof.mounts.some(
        (mount) =>
          mount.root === root.rootPath &&
          mount.pvcUid === root.pvcUid &&
          mount.volumeName === root.volumeName &&
          mount.volumePath === root.volumePath,
      ),
    );
  } catch {
    return false;
  }
}
function fresh(
  proof: ReturnType<typeof CanonicalMountEvidenceSchema.parse>,
): boolean {
  const now = Date.now(),
    captured = Date.parse(proof.capturedAt),
    expires = Date.parse(proof.expiresAt);
  return (
    captured <= now &&
    expires > now &&
    expires - captured <= 120_000 &&
    proof.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG)
  );
}
