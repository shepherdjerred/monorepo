import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { RequestMovieRollbackRetryV1 } from "#shared/movie-editions/rollback/retry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { queueOperation } from "#automation/store.ts";
import { readMovieRollbackRetryParentV1 } from "./retry-parent.ts";
import {
  captureMovieRollbackRetryContextV1,
  type MovieRollbackRetryInvocationV1,
} from "./retry-context.ts";
import { requestedMovieRollbackConflict } from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  movieRollbackRetryParticipantsV1,
  assertClosedMovieRollbackRetryParticipantsV1,
  type ClosedMovieRollbackRetryParticipantV1,
} from "./retry-pending.ts";

export async function queueMovieRollbackRetryV1(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    key: string;
    command: RequestMovieRollbackRetryV1;
    access: MovieChoiceAccess;
    invocation: MovieRollbackRetryInvocationV1;
    closedParticipants: readonly ClosedMovieRollbackRetryParticipantV1[];
  },
) {
  const { command, invocation } = input;
  await bindPlexTransactionDeadline(tx, invocation.execution);
  const locked = await lockMovieCommand(tx, command.scope);
  invocation.budget.consume(locked.target === null ? 1 : 2);
  await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${command.resume.operationId} FOR UPDATE`;
  const parent = await readMovieRollbackRetryParentV1(
    tx,
    command,
    invocation.budget,
  );
  if (
    z
      .object({ movieRollbackPlexV1: z.unknown().optional() })
      .nullable()
      .parse(parent.operation.result)?.movieRollbackPlexV1 !== undefined
  )
    throw requestedMovieRollbackConflict(
      "The original rollback is already complete",
    );
  const captured = await captureMovieRollbackRetryContextV1(tx, {
    ...input,
    parent,
  });
  if (identityHash(captured.expected) !== identityHash(command.expected))
    throw requestedMovieRollbackConflict(
      "Review the current admitted rollback before retrying",
    );
  const pending = await movieRollbackRetryParticipantsV1(
    tx,
    parent.operation.id,
    invocation,
  );
  assertClosedMovieRollbackRetryParticipantsV1(
    pending,
    input.closedParticipants,
  );
  const operationId = await queueOperation(tx, {
    key: `requested-movie-rollback-retry:${input.actorId}:${input.key}`,
    kind: "rollback_movie_edition_v1",
    targetId: command.scope.mediaId,
    userId: input.actorId,
    budget: invocation.budget,
    availableAt: new Date(),
    payload: {
      schemaVersion: 1,
      scope: command.scope,
      sourceAttemptId: command.sourceAttemptId,
      resume: command.resume,
      mediaId: command.scope.mediaId,
      generation: command.expected.generation,
      recoveryEpoch: command.expected.recoveryEpoch,
      actorId: input.actorId,
      source: parent.intent.invocation.source,
      invocation: parent.intent.invocation,
      retry: z.record(z.string(), z.json()).parse(command),
    },
  });
  captured.authority.freshness.assertActive();
  return {
    schemaVersion: 1 as const,
    operationId,
    scope: command.scope,
    sourceAttemptId: command.sourceAttemptId,
    status: "queued" as const,
  };
}
