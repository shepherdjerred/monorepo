import type { Prisma, Operation } from "#generated/prisma/client.ts";
import {
  MovieRollbackRetryOperationV1Schema,
  RequestedMovieRollbackRetryPayloadV1Schema,
  type MovieRollbackRetryOperationV1,
} from "#shared/movie-editions/rollback/retry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

export async function readMovieRollbackRetryCommandV1(
  tx: Prisma.TransactionClient,
  raw: MovieRollbackRetryOperationV1,
  budget: PublicationAuthorityReadBudget,
) {
  const input = MovieRollbackRetryOperationV1Schema.parse(raw);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  return parseMovieRollbackRetryCommandV1(operation, input);
}

export function parseMovieRollbackRetryCommandV1(
  operation: Operation,
  input: MovieRollbackRetryOperationV1,
) {
  const payload = RequestedMovieRollbackRetryPayloadV1Schema.parse(
    operation.payload,
  );
  if (
    identityHash(payload) !== identityHash(operation.payload) ||
    operation.id !== input.operationId ||
    operation.kind !== "rollback_movie_edition_v1" ||
    operation.targetId !== input.scope.mediaId ||
    operation.userId !== payload.actorId ||
    payload.operationId !== operation.id ||
    payload.mediaId !== input.scope.mediaId ||
    payload.sourceAttemptId !== input.sourceAttemptId ||
    payload.source.attemptId !== input.sourceAttemptId ||
    identityHash(payload.scope) !== identityHash(input.scope) ||
    identityHash(payload.source.scope) !== identityHash(input.scope) ||
    identityHash(payload.invocation.source) !== identityHash(payload.source) ||
    identityHash(payload.resume) !== identityHash(input.resume) ||
    !matchesRetryReview(payload, input)
  )
    throw new Error(
      "Movie rollback retry lost its exact authenticated owner command",
    );
  if (
    (payload.invocation.mode === "manual_verified"
      ? payload.invocation.command.operationId
      : payload.invocation.source.operationId) !== input.resume.operationId
  )
    throw new Error(
      "Movie rollback retry changed its exact original invocation",
    );
  return { operation, payload, input };
}

function matchesRetryReview(
  payload: ReturnType<typeof RequestedMovieRollbackRetryPayloadV1Schema.parse>,
  input: MovieRollbackRetryOperationV1,
) {
  return (
    identityHash(payload.retry.scope) === identityHash(input.scope) &&
    payload.retry.sourceAttemptId === input.sourceAttemptId &&
    identityHash(payload.retry.resume) === identityHash(input.resume) &&
    payload.generation === payload.retry.expected.generation &&
    payload.recoveryEpoch === payload.retry.expected.recoveryEpoch
  );
}
