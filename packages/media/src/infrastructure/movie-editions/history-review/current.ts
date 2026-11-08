import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MovieHistoryScopeV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { lockMovieHistoryV3, movieHistoryConflict } from "./locks.ts";
import { snapshotMovieHistoryV3 } from "./snapshot.ts";

export const movieHistoryHash = (value: unknown) =>
  identityHash(nativeJson(value));

export async function currentMovieHistoryReviewV3(
  tx: Prisma.TransactionClient,
  input: { id: string; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const initial = await tx.recoveryReview.findUnique({
    where: { id: input.id },
  });
  budget.consume(initial === null ? 0 : 1);
  if (initial === null)
    throw new MediaError(
      "recovery_not_found",
      "Movie history review does not exist",
      404,
    );
  const scope = MovieHistoryScopeV3Schema.parse(initial.scope);
  await lockMovieHistoryV3(tx, scope.scope);
  await tx.$queryRaw`SELECT id FROM "RecoveryReview" WHERE id=${input.id} FOR UPDATE`;
  const review = await tx.recoveryReview.findUniqueOrThrow({
    where: { id: input.id },
  });
  budget.consume(1);
  if (
    review.state !== "awaiting_responses" ||
    review.expiresAt.getTime() <= Date.now()
  )
    throw movieHistoryConflict(
      "Prepare a new review; this movie history review is closed or expired",
    );
  const captured = await snapshotMovieHistoryV3(
    tx,
    { scope: scope.scope, access: input.access },
    budget,
  );
  if (
    movieHistoryHash(captured.scope) !== review.scopeHash ||
    movieHistoryHash(scope) !== review.scopeHash
  )
    throw movieHistoryConflict(
      "Movie facts, household, consent, pins or physical history changed; prepare a fresh review",
    );
  return { review, scope, freshness: captured.freshness, sql: captured.sql };
}

export async function currentMovieHistoryOwnerV3(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  if (owner.role !== "owner" || owner.restricted)
    throw new MediaError(
      "owner_required",
      "A current unrestricted owner must review movie history",
      403,
    );
}
