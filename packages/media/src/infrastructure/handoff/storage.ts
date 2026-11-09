import type { Database } from "#infrastructure/database.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { queueOwnerHealth } from "#infrastructure/notifications/owner-health.ts";
import { runtimeAuthority } from "./authority.ts";

/** Caller holds the runtime UPDATE lock and selects the exact affected roots. */
export async function revokeObservedStorage(
  tx: Prisma.TransactionClient,
  input: {
    where: Prisma.MediaStorageAuthorityWhereInput;
    revokeRuntime: boolean;
    evidenceDigest: string;
  },
) {
  await tx.mediaStorageAuthority.updateMany({
    where: input.where,
    data: { revokedAt: new Date(), version: { increment: 1 } },
  });
  if (!input.revokeRuntime) return;
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
    evidenceDigest: input.evidenceDigest,
  });
}

/** Called after the effect's runtime SHARE lock; refresh/revocation takes runtime UPDATE. */
export async function requireStorageAuthority(
  db: Database,
  rootPath: string,
  workerPodUid: string,
): Promise<void> {
  const runtime = await runtimeAuthority(db);
  const authority = await db.mediaStorageAuthority.findUnique({
    where: { rootPath },
  });
  const timestamp = Date.now();
  if (
    authority?.revokedAt !== null ||
    !runtime.active ||
    authority.recoveryEpoch !== runtime.epoch ||
    authority.workerPodUid !== workerPodUid ||
    authority.observedAt.getTime() > timestamp ||
    authority.expiresAt.getTime() <= timestamp ||
    authority.expiresAt.getTime() - authority.observedAt.getTime() > 120_000
  )
    throw new Error(
      "Media storage authority is absent, stale, or belongs to another executor",
    );
}
