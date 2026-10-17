import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";

type AuthorityDatabase = Pick<
  Prisma.TransactionClient,
  "mediaRuntimeState" | "legacyWriterLease"
>;

/** Current runtime permission also requires a recent trusted observation of retired writers. */
export async function runtimeAuthority(
  db: AuthorityDatabase,
): Promise<{ active: boolean; epoch: number }> {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.mode !== "active" && runtime.mode !== "observe")
    throw new Error("Invalid media runtime mode");
  if (runtime.mode !== "active" || !runtime.ownershipConfirmed)
    return { active: false, epoch: runtime.recoveryEpoch };
  const lease = await db.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  const now = Date.now();
  return {
    epoch: runtime.recoveryEpoch,
    active:
      lease !== null &&
      lease.revokedAt === null &&
      lease.recoveryEpoch === runtime.recoveryEpoch &&
      lease.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG) &&
      lease.targetsDigest ===
        snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments) &&
      lease.observedAt.getTime() <= now &&
      lease.expiresAt.getTime() > now &&
      lease.expiresAt.getTime() - lease.observedAt.getTime() <= 120_000,
  };
}

/** Caller holds media locks first; SHARE prevents apply/revocation from racing an effect. */
export async function lockRuntimeAuthority(
  tx: Prisma.TransactionClient,
  epoch: number,
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  const authority = await runtimeAuthority(tx);
  return authority.active && authority.epoch === epoch;
}

/** Explicit user demand may authorize new work only while the runtime itself is authorized. */
export async function commandAutomationEpoch(
  tx: Prisma.TransactionClient,
): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  const authority = await runtimeAuthority(tx);
  return authority.active ? authority.epoch : -1;
}

/** Record authority is independent of mutable intent generations and runtime activation. */
export async function recordsAuthorized(
  tx: Prisma.TransactionClient,
  input: {
    epoch: number;
    mediaIds: readonly string[];
    assetIds?: readonly string[];
  },
): Promise<boolean> {
  const mediaIds = [...new Set(input.mediaIds)];
  const assetIds = [...new Set(input.assetIds)];
  const intents = await tx.mediaIntent.count({
    where: { mediaId: { in: mediaIds }, automationEpoch: input.epoch },
  });
  if (intents !== mediaIds.length) return false;
  const assets = await tx.libraryAsset.count({
    where: { id: { in: assetIds }, owned: true, ownershipEpoch: input.epoch },
  });
  return assets === assetIds.length;
}
