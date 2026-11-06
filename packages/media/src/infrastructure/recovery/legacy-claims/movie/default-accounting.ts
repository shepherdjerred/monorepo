import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { RecoveryScopeSchema } from "#shared/recovery.ts";
import { RecoveryClaimAccountingSchema } from "#shared/recovery-claims.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { claimIdentityHash } from "#infrastructure/recovery/legacy-claims/accounting.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type HistoricalReceipt = {
  scopeHash: string;
  releasedHoldIds: string[];
  claimAccounting: Prisma.JsonValue;
  reviewScopeHash: string;
  reviewState: string;
  reviewEpoch: number;
  reviewScope: Prisma.JsonValue;
};

/** Original unscoped v1/v2 reviews mean default only; their literal records are never rewritten. */
export async function accountedDefaultMovieClaimsV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.scope.edition !== "default")
    throw new Error(
      "Historical id-only accounting cannot authorize a named cut",
    );
  const selected = JSON.stringify([{ mediaIds: [input.scope.mediaId] }]);
  // Missing discriminator means literal v1. Unknown future protocols are excluded BEFORE the bound.
  const receipts = await tx.$queryRaw<HistoricalReceipt[]>`
    SELECT r."scopeHash",r."releasedHoldIds",r."claimAccounting",v."scopeHash" AS "reviewScopeHash",
      v.state AS "reviewState",v."recoveryEpoch" AS "reviewEpoch",v.scope AS "reviewScope"
    FROM "RecoveryReleaseReceipt" r JOIN "RecoveryReview" v ON v.id=r."reviewId"
    WHERE r."recoveryEpoch"=${input.epoch} AND r."claimAccounting" @> ${selected}::jsonb
      AND (NOT (v.scope ? 'schemaVersion') OR v.scope->'schemaVersion'='2'::jsonb)
    ORDER BY r.id LIMIT ${budget.takeWeighted(2)}
  `;
  budget.consume(receipts.length * 2);
  const accounted = new Set<string>();
  for (const receipt of receipts) {
    const scope = RecoveryScopeSchema.parse(receipt.reviewScope);
    if (
      receipt.reviewState !== "released" ||
      receipt.scopeHash !== receipt.reviewScopeHash ||
      hash(receipt.reviewScope) !== receipt.scopeHash ||
      scope.recoveryEpoch !== input.epoch ||
      receipt.reviewEpoch !== input.epoch ||
      !scope.holds.some((hold) => hold.mediaId === input.scope.mediaId) ||
      !scope.media.some(
        (media) => media.id === input.scope.mediaId && media.kind === "movie",
      ) ||
      !receipt.releasedHoldIds.includes(input.scope.mediaId)
    )
      throw new Error(
        "Historical default movie claim accounting lost its literal review parent",
      );
    const ledger = z
      .array(RecoveryClaimAccountingSchema)
      .max(1000)
      .parse(receipt.claimAccounting);
    for (const entry of ledger)
      if (entry.mediaIds.includes(input.scope.mediaId))
        accounted.add(claimIdentityHash(entry));
  }
  return { identities: accounted, receipts: receipts.length };
}
