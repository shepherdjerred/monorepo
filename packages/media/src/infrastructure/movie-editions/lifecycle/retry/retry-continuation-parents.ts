import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MediaError } from "#application/errors.ts";
import { MovieRetryContinuationV2Schema } from "#shared/movie-editions/retry/v2.ts";

/** Call under canonical/target/runtime/attempt locks; no filesystem observations occur on Network. */
export async function captureMovieRetryContinuationV2(
  tx: Prisma.TransactionClient,
  input: { attempt: AcquisitionAttempt; scope: MovieEditionScope },
  budget: PublicationAuthorityReadBudget,
) {
  const { attempt, scope } = input;
  if (
    !["validating", "imported"].includes(attempt.state) ||
    attempt.filePlan === null
  )
    throw new MediaError(
      "movie_retry_continuation_scope",
      "This movie phase has no prepared continuation",
      409,
    );
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
  if (
    plan.attemptId !== attempt.id ||
    identityHash(plan.scope) !== identityHash(scope) ||
    identityHash(plan) !== identityHash(attempt.filePlan)
  )
    throw new Error(
      "Prepared movie continuation changed its literal scoped plan",
    );
  const publication = await loadMoviePublicationV2(tx, attempt.id, budget);
  if (publication !== null && publication.outcome?.kind === "compensated")
    throw new MediaError(
      "movie_publication_compensated",
      "Compensated publication cannot renew its acquisition coordinator",
      409,
    );
  if (attempt.state === "imported") {
    if (
      publication?.outcome?.kind !== "published" ||
      publication.outcomeHash === null
    )
      throw new Error(
        "Imported movie continuation lost its actual immutable physical outcome",
      );
    const original = publication.outcome.entries[0].successor;
    if (original === null)
      throw new Error("Published movie continuation has no actual successor");
    const current = await snapshotMoviePublicationAssetV2(
      tx,
      scope,
      original.id,
      budget,
    );
    assertPublicationSnapshotSuccessor(original, current);
    if (
      current.state !== "published" ||
      current.version !== original.version ||
      !current.coverage[0].current
    )
      throw new MediaError(
        "movie_retry_continuation_scope",
        "Original movie publication no longer owns its exact physical version",
        409,
      );
  }
  const beforeAttempt = nativeAttempt(attempt);
  return MovieRetryContinuationV2Schema.parse({
    phase: attempt.state === "imported" ? "imported" : "prepared",
    filePlanHash: identityHash(attempt.filePlan),
    beforeAttemptHash: identityHash(beforeAttempt),
    publication:
      publication === null
        ? null
        : {
            transitionId: publication.reference.transitionId,
            intentHash: publication.reference.intentHash,
            attemptSnapshotHash:
              publication.reference.intent.attemptSnapshotHash,
            outcomeHash: publication.outcomeHash,
          },
  });
}
