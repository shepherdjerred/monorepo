import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieRollbackIntentEnvelopeV1Schema } from "#shared/movie-editions/rollback/physical.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";

/** Discovery protects forward work. It does not grant rollback or infer native
 * completion; the phase readers still validate their actual immutable parents. */
export async function movieRollbackForwardFenceV1(
  tx: Prisma.TransactionClient,
  source: MovieAttemptOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const operations = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: [
              "movieRollbackIntentV1",
              "intent",
              "invocation",
              "source",
              "attemptId",
            ],
            equals: source.attemptId,
          },
        },
        {
          result: {
            path: ["movieRollbackIntentV1", "intent", "scope"],
            equals: source.scope,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(operations.length);
  if (operations.length === 0) return null;
  if (operations.length !== 1)
    throw new Error("Movie rollback forward fence is ambiguous");
  const operation = operations[0];
  if (operation === undefined)
    throw new Error("Movie rollback forward fence disappeared");
  const envelope = MovieRollbackIntentEnvelopeV1Schema.parse(
    typeof operation.result === "object" &&
      operation.result !== null &&
      !Array.isArray(operation.result)
      ? operation.result["movieRollbackIntentV1"]
      : undefined,
  );
  const intent = parsePlexRecord(
    MovieRollbackIntentEnvelopeV1Schema.shape.intent,
    envelope.intent,
    envelope.intentHash,
  );
  assertMovieRollbackCanonical(
    envelope.raw,
    envelope.intent,
    envelope.intentHash,
  );
  if (
    intent.operationId !== operation.id ||
    identityHash(intent.scope) !== identityHash(source.scope) ||
    intent.invocation.source.attemptId !== source.attemptId
  )
    throw new Error("Movie rollback forward fence changed its actual source");
  return {
    intent,
    operation,
    reason:
      intent.invocation.mode === "automatic_failed_plex" &&
      intent.invocation.source.operationId === source.operationId
        ? "resume_movie_rollback"
        : "movie_rollback_active",
  };
}

export async function movieRollbackObservationV1(
  tx: Prisma.TransactionClient,
  source: MovieAttemptOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const fence = await movieRollbackForwardFenceV1(tx, source, budget);
  return fence === null
    ? null
    : {
        status:
          fence.reason === "resume_movie_rollback"
            ? ("ready" as const)
            : ("blocked" as const),
        reason: fence.reason,
      };
}
