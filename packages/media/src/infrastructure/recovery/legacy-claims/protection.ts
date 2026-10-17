import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";
import { buildRecoveryClaims } from "./projection.ts";
import { lockLegacyClaimKnowledge } from "./knowledge-fence.ts";

export const LEGACY_CLAIM_PROTECTION = "legacy_claim_reconciliation_required";
export class PendingLegacyClaimsError extends Error {
  constructor(readonly mediaIds: readonly string[]) {
    super(LEGACY_CLAIM_PROTECTION);
  }
}

/** Caller holds selected media/runtime first; keep this read fence through the effect. */
export async function hasPendingLegacyClaims(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  if (mediaIds.length === 0)
    throw new Error("Legacy claim protection requires selected media");
  const ids = [...new Set(mediaIds)].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId" FOR UPDATE`,
  );
  const users = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "MediaUser" ORDER BY id LIMIT 101 FOR SHARE`;
  if (users.length > 100 || ids.length > 100) return true;
  if (users.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(users.map((user) => user.id))}) ORDER BY "userId" FOR SHARE`,
    );
  await lockLegacyClaimKnowledge(tx);
  const adoptions = await tx.applicationEvent.findMany({
    where: { mediaId: { in: ids }, kind: "handoff_media_adopted" },
    orderBy: { id: "asc" },
    take: 1001,
  });
  if (adoptions.length > 1000) return true;
  const planIds = adoptions.map(
    (row) => z.object({ planId: z.uuid() }).parse(row.payload).planId,
  );
  const knowledge = await buildRecoveryClaims(tx, { planIds, mediaIds: ids });
  return knowledge.claims.length > 0 || knowledge.blockers.length > 0;
}

export async function assertLegacyClaimsResolved(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  if (await hasPendingLegacyClaims(tx, mediaIds))
    throw new PendingLegacyClaimsError(mediaIds);
}

/** Durable repair is separate from a rejected effect transaction, so owners can resolve the hold. */
export async function reopenLegacyClaimProtection(
  db: Database,
  mediaIds: readonly string[],
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const ids = [...new Set(mediaIds)].sort();
          await lockMedia(tx, ids);
          await lockEffectiveRequests(tx, ids);
          await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`;
          if (!(await hasPendingLegacyClaims(tx, ids))) return false;
          await persistLegacyClaimProtection(tx, ids);
          return true;
        },
        { isolationLevel: "Serializable", timeout: 15_000 },
      );
    } catch (error) {
      if (attempt < 3 && isRetryableTransaction(error)) continue;
      throw error;
    }
  }
  throw new Error("Legacy claim protection retries exhausted");
}

/** Called only after the selected media, holds, identities and knowledge fence are held. */
export async function persistLegacyClaimProtection(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  for (const mediaId of mediaIds) {
    const hold = await tx.recoveryHold.findUnique({ where: { mediaId } });
    if (hold !== null && hold.releasedAt === null) continue;
    await tx.recoveryHold.upsert({
      where: { mediaId },
      create: {
        mediaId,
        recoveryEpoch: runtime.recoveryEpoch,
        reason: LEGACY_CLAIM_PROTECTION,
      },
      update: {
        recoveryEpoch: runtime.recoveryEpoch,
        reason: LEGACY_CLAIM_PROTECTION,
        releasedAt: null,
        releasedById: null,
        releaseEvidence: Prisma.DbNull,
        version: { increment: 1 },
      },
    });
    await tx.retentionDecision.updateMany({
      where: {
        mediaId,
        state: { in: ["eligible", "warning_pending", "grace_period"] },
      },
      data: {
        state: "cancelled",
        warningAcceptedAt: null,
        graceUntil: null,
        version: { increment: 1 },
      },
    });
    // Retain the exact quarantine manifest and elapsed recovery window. A fresh
    // household release changes intent generation; old warning acceptance cannot resume purge.
    await tx.retentionDecision.updateMany({
      where: { mediaId, state: "quarantined" },
      data: {
        warningAcceptedAt: null,
        graceUntil: null,
        version: { increment: 1 },
      },
    });
    await tx.applicationEvent.create({
      data: {
        mediaId,
        kind: "recovery_legacy_claim_protected",
        payload: {
          recoveryEpoch: runtime.recoveryEpoch,
          reason: LEGACY_CLAIM_PROTECTION,
        },
      },
    });
  }
}
