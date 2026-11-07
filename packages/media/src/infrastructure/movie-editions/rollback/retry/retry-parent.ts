import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import { MovieRollbackIntentEnvelopeV1Schema } from "#shared/movie-editions/rollback/physical.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { rollbackIntentFromOperationV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { requestedMovieRollbackConflict } from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";

/** Actual original record only; the retry never copies or rewrites admission. */
export async function readMovieRollbackRetryParentV1(
  tx: Prisma.TransactionClient,
  input: Pick<
    MovieRollbackRetryOperationV1,
    "scope" | "sourceAttemptId" | "resume"
  >,
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.resume.operationId },
  });
  budget.consume(1);
  const marker = z
    .object({ movieRollbackIntentV1: MovieRollbackIntentEnvelopeV1Schema })
    .parse(operation.result).movieRollbackIntentV1;
  const parent = await rollbackIntentFromOperationV1(tx, {
    operation,
    invocation: marker.intent.invocation,
    budget,
  });
  if (
    parent?.intentHash !== input.resume.intentHash ||
    parent.intent.invocation.source.attemptId !== input.sourceAttemptId ||
    identityHash(parent.intent.scope) !== identityHash(input.scope)
  )
    throw requestedMovieRollbackConflict(
      "The selected original rollback admission changed",
    );
  return parent;
}
