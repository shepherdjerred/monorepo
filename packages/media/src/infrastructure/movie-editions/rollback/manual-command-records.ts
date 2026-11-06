import type { Prisma, Operation } from "#generated/prisma/client.ts";
import { RequestedMovieRollbackPayloadV1Schema } from "#shared/movie-editions/rollback/manual-command.ts";
import {
  MovieRollbackOperationV1Schema,
  type MovieRollbackOperationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Literal command reader has no current authority or queue/command producer dependency. */
export async function readRequestedMovieRollbackCommandV1(
  tx: Prisma.TransactionClient,
  raw: MovieRollbackOperationV1,
  budget: PublicationAuthorityReadBudget,
) {
  const input = MovieRollbackOperationV1Schema.parse(raw);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  return parseRequestedMovieRollbackCommandV1(operation, input);
}

/** Only a row actually queried by the caller's current transaction may feed
 * this literal parser. It grants no current owner or Files authority. */
export function parseRequestedMovieRollbackCommandV1(
  operation: Operation,
  raw: MovieRollbackOperationV1,
) {
  const input = MovieRollbackOperationV1Schema.parse(raw);
  const payload = RequestedMovieRollbackPayloadV1Schema.parse(
    operation.payload,
  );
  if (
    identityHash(payload) !== identityHash(operation.payload) ||
    operation.kind !== "rollback_movie_edition_v1" ||
    operation.targetId !== input.scope.mediaId ||
    operation.userId !== payload.actorId ||
    payload.operationId !== operation.id ||
    payload.sourceAttemptId !== input.sourceAttemptId ||
    payload.source.attemptId !== input.sourceAttemptId ||
    payload.mediaId !== input.scope.mediaId ||
    identityHash(payload.scope) !== identityHash(input.scope) ||
    identityHash(payload.source.scope) !== identityHash(input.scope) ||
    identityHash(payload.request.scope) !== identityHash(input.scope) ||
    payload.request.sourceAttemptId !== input.sourceAttemptId ||
    payload.generation !== payload.request.expected.generation ||
    payload.recoveryEpoch !== payload.request.expected.recoveryEpoch
  )
    throw new Error(
      "Requested movie rollback lost its literal owner command or selected cut",
    );
  return {
    operation,
    payload,
    source: payload.source,
    expected: payload.request.expected,
  };
}
