import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieHistoryScopeV3Schema,
  MovieHistoryClaimAccountingV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  claimAccounting,
  claimIdentityHash,
} from "#infrastructure/recovery/legacy-claims/accounting.ts";
import { accountedDefaultMovieClaimsV3 } from "./default-accounting.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** A current cut reads only its own literal v3 ledger; old id-only arrays grant no named authority. */
export async function accountedMovieClaimsV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; epoch: number },
  budget: PublicationAuthorityReadBudget,
) {
  const receipts = await tx.recoveryReleaseReceipt.findMany({
    where: {
      recoveryEpoch: input.epoch,
      review: { scope: { path: ["schemaVersion"], equals: 3 } },
      AND: [
        { claimAccounting: { path: ["schemaVersion"], equals: 3 } },
        { claimAccounting: { path: ["scope"], equals: input.scope } },
      ],
    },
    include: { review: true },
    orderBy: { id: "asc" },
    take: budget.takeWeighted(2),
  });
  budget.consume(receipts.length * 2);
  const accounted = new Set<string>();
  for (const receipt of receipts) {
    const original = MovieHistoryScopeV3Schema.parse(receipt.review.scope);
    const ledger = MovieHistoryClaimAccountingV3Schema.parse(
      receipt.claimAccounting,
    );
    if (
      receipt.review.state !== "released" ||
      receipt.reviewId !== receipt.review.id ||
      receipt.scopeHash !== receipt.review.scopeHash ||
      receipt.scopeHash !== hash(original) ||
      receipt.recoveryEpoch !== original.recoveryEpoch ||
      original.recoveryEpoch !== input.epoch ||
      hash(original.scope) !== hash(input.scope) ||
      hash(ledger.scope) !== hash(input.scope) ||
      hash(receipt.releasedHoldIds) !== hash([input.scope.mediaId]) ||
      hash(ledger.claims) !== hash(claimAccounting(original.legacyClaims))
    )
      throw new Error(
        "Movie household claim ledger lost its exact original review scope",
      );
    for (const claim of ledger.claims) {
      if (hash(claim.mediaIds) !== hash([input.scope.mediaId]))
        throw new Error(
          "Movie household accounting changed its selected canonical movie",
        );
      accounted.add(claimIdentityHash(claim));
    }
  }
  const historical =
    input.scope.edition === "default"
      ? await accountedDefaultMovieClaimsV3(tx, input, budget)
      : null;
  if (historical !== null)
    for (const claim of historical.identities) accounted.add(claim);
  return {
    identities: accounted,
    scopedReceipts: receipts.length,
    defaultReceipts: historical?.receipts ?? 0,
  };
}
