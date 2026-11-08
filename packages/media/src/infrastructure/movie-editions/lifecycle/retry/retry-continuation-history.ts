import type { Operation, Prisma } from "#generated/prisma/client.ts";
import type { MovieRetryRenewalV2 } from "#shared/movie-editions/retry/v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieRetryBirthHash } from "./retry-source.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";

/** Completion may advance the actual outcome; original plan, captured intent and any completed outcome remain literal. */
export async function readMovieContinuationHistoryV2(
  tx: Prisma.TransactionClient,
  input: { receipt: MovieRetryRenewalV2; operation: Operation },
  budget: PublicationAuthorityReadBudget,
) {
  const { receipt, operation } = input;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: receipt.capture.attemptId },
  });
  budget.consume(1);
  if (
    receipt.commandHash !== identityHash(operation.payload) ||
    movieRetryBirthHash(attempt) !== receipt.capture.birthHash ||
    identityHash(attempt.filePlan) !== receipt.capture.continuation.filePlanHash
  )
    throw new Error(
      "Movie continuation renewal changed its original command, birth or plan",
    );
  const publication = await loadMoviePublicationV2(tx, attempt.id, budget);
  const original = receipt.capture.continuation.publication;
  if (
    original !== null &&
    (publication?.reference.transitionId !== original.transitionId ||
      publication.reference.intentHash !== original.intentHash ||
      publication.reference.intent.attemptSnapshotHash !==
        original.attemptSnapshotHash ||
      (original.outcomeHash !== null &&
        publication.outcomeHash !== original.outcomeHash))
  )
    throw new Error(
      "Movie continuation lost its exact captured physical publication parent",
    );
  return attempt;
}
