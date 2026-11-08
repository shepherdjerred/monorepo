import type { Prisma } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

import {
  readRuntimeProof,
  RuntimeProofError,
  type RuntimeProofDatabase,
} from "./runtime-proof.ts";

type AuthorityDatabase = RuntimeProofDatabase;

/** Runtime permission requires current storage, or retired-writer proof for adopted storage. */
export async function runtimeAuthority(
  db: AuthorityDatabase,
  budget?: PublicationAuthorityReadBudget,
): Promise<{ active: boolean; epoch: number }> {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.mode !== "active" && runtime.mode !== "observe")
    throw new Error("Invalid media runtime mode");
  if (runtime.mode !== "active" || !runtime.ownershipConfirmed)
    return { active: false, epoch: runtime.recoveryEpoch };
  let lease;
  try {
    lease = await readRuntimeProof(db, budget);
  } catch (error) {
    if (!(error instanceof RuntimeProofError)) throw error;
    return { active: false, epoch: runtime.recoveryEpoch };
  }
  const now = Date.now();
  return {
    epoch: runtime.recoveryEpoch,
    active:
      lease.revokedAt === null &&
      lease.recoveryEpoch === runtime.recoveryEpoch &&
      (lease.kind === "canonical_storage" ||
        (lease.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG) &&
          lease.targetsDigest ===
            snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments))) &&
      lease.observedAt.getTime() <= now &&
      lease.expiresAt.getTime() > now &&
      lease.expiresAt.getTime() - lease.observedAt.getTime() <= 120_000,
  };
}

/** Caller holds media locks first; SHARE prevents apply/revocation from racing an effect. */
export async function lockRuntimeAuthority(
  tx: Prisma.TransactionClient,
  epoch: number,
  budget?: PublicationAuthorityReadBudget,
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" WHERE "rootPath" IN ('/data/movies', '/data/tv') FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  const authority = await runtimeAuthority(tx, budget);
  return authority.active && authority.epoch === epoch;
}

/** Explicit user demand may authorize new work only while the runtime itself is authorized. */
export async function commandAutomationEpoch(
  tx: Prisma.TransactionClient,
): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT "rootPath" FROM "MediaStorageAuthority" WHERE "rootPath" IN ('/data/movies', '/data/tv') FOR SHARE`;
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
    where: {
      mediaId: { in: mediaIds },
      edition: "default",
      editionRootId: { not: null },
      automationEpoch: input.epoch,
    },
  });
  if (intents !== mediaIds.length) return false;
  const assets = await tx.libraryAsset.count({
    where: {
      id: { in: assetIds },
      edition: "default",
      editionRootId: { not: null },
      owned: true,
      ownershipEpoch: input.epoch,
    },
  });
  return assets === assetIds.length;
}
