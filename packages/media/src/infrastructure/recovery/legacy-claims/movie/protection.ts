import { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockLegacyClaimKnowledge } from "#infrastructure/recovery/legacy-claims/knowledge-fence.ts";
import {
  LEGACY_CLAIM_PROTECTION,
  PendingLegacyClaimsError,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { maybeMovieHistoryAdoptionSourceV3 } from "#infrastructure/movie-editions/history-review/source.ts";
import { buildMovieRecoveryClaimsV3 } from "./projection.ts";

/** Caller holds canonical target/runtime locks. Every explicit cut gets its own ledger. */
export async function hasPendingMovieLegacyClaimsV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  await tx.$queryRaw`SELECT "mediaId",edition FROM "RecoveryHold" WHERE "mediaId"=${input.scope.mediaId} AND edition=${input.scope.edition} FOR UPDATE`;
  const users = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "MediaUser" ORDER BY id LIMIT 101 FOR SHARE`;
  if (users.length > 100) return true;
  if (users.length > 0)
    await tx.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(users.map((row) => row.id))}) ORDER BY "userId" FOR SHARE`,
    );
  await lockLegacyClaimKnowledge(tx);
  const original = await maybeMovieHistoryAdoptionSourceV3(tx, input, budget);
  const knowledge = await buildMovieRecoveryClaimsV3(
    tx,
    {
      ...input,
      ...(original === null ? {} : { report: original.report }),
    },
    budget,
  );
  return knowledge.claims.length > 0 || knowledge.blockers.length > 0;
}

export async function assertMovieLegacyClaimsResolvedV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  if (await hasPendingMovieLegacyClaimsV3(tx, input, budget))
    throw new PendingLegacyClaimsError([input.scope.mediaId]);
}

/** A committed protected evaluation reopens only its selected cut; rejected effects never claim to persist this. */
export async function persistMovieLegacyClaimProtectionV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
) {
  const where = {
    mediaId_edition: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
    },
  };
  const hold = await tx.recoveryHold.findUnique({ where });
  if (hold !== null && hold.releasedAt === null) return;
  await tx.recoveryHold.upsert({
    where,
    create: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      recoveryEpoch: input.epoch,
      reason: LEGACY_CLAIM_PROTECTION,
    },
    update: {
      recoveryEpoch: input.epoch,
      reason: LEGACY_CLAIM_PROTECTION,
      releasedAt: null,
      releasedById: null,
      releaseEvidence: Prisma.DbNull,
      version: { increment: 1 },
    },
  });
  await tx.retentionDecision.updateMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: {
      state: "cancelled",
      warningAcceptedAt: null,
      graceUntil: null,
      version: { increment: 1 },
    },
  });
  await tx.retentionDecision.updateMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      state: "quarantined",
    },
    data: {
      warningAcceptedAt: null,
      graceUntil: null,
      version: { increment: 1 },
    },
  });
  await tx.applicationEvent.create({
    data: {
      mediaId: input.scope.mediaId,
      kind: "movie_history_claim_protected_v3",
      payload: {
        schemaVersion: 3,
        scope: input.scope,
        recoveryEpoch: input.epoch,
        reason: LEGACY_CLAIM_PROTECTION,
      },
    },
  });
}
