import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MovieRollbackRetryOperationV1Schema } from "#shared/movie-editions/rollback/retry.ts";
import { MovieRetryClosedWorkflowV1Schema } from "#shared/movie-editions/retry/v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parseMovieRollbackRetryCommandV1 } from "./retry-command-records.ts";
import { requestedMovieRollbackConflict } from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";
import type {
  MovieRollbackRetryInvocationV1,
  MovieRollbackRetryParentV1,
} from "./retry-context.ts";

export type ClosedMovieRollbackRetryParticipantV1 = {
  operationId: string;
  payloadHash: string;
  dispatchedAt: string;
};

export async function movieRollbackRetryParticipantsV1(
  tx: Prisma.TransactionClient,
  parentId: string,
  invocation: MovieRollbackRetryInvocationV1,
) {
  const rows = await tx.operation.findMany({
    where: {
      kind: "rollback_movie_edition_v1",
      status: { in: ["queued", "running"] },
      payload: { path: ["resume", "operationId"], equals: parentId },
    },
    include: { outbox: true },
    take: invocation.budget.takeWeighted(2),
  });
  invocation.budget.consume(
    rows.reduce((count, row) => count + 1 + (row.outbox === null ? 0 : 1), 0),
  );
  return rows;
}

/** Negative duplicate-participant exclusion only. The Network grant must still
 * freshly close the actual current owner and win the original pointer CAS. */
export async function observeClosedMovieRollbackRetryParticipantsV1(
  tx: Prisma.TransactionClient,
  input: {
    parent: MovieRollbackRetryParentV1;
    describe: MediaAutomationContext["describeWorkflow"];
    invocation: MovieRollbackRetryInvocationV1;
  },
) {
  const rows = await movieRollbackRetryParticipantsV1(
    tx,
    input.parent.operation.id,
    input.invocation,
  );
  const terminal: ClosedMovieRollbackRetryParticipantV1[] = [];
  for (const row of rows) {
    const thin = z
      .object(MovieRollbackRetryOperationV1Schema.shape)
      .parse(row.payload);
    const parsed = parseMovieRollbackRetryCommandV1(row, thin);
    if (
      identityHash(parsed.payload.invocation) !==
        identityHash(input.parent.intent.invocation) ||
      thin.resume.intentHash !== input.parent.intentHash
    )
      throw new Error(
        "Pending rollback retry lost its actual admitted inverse",
      );
    const participant = dispatchedParticipant(row);
    if (participant === null)
      throw requestedMovieRollbackConflict(
        "An exact rollback retry has not completed dispatch",
      );
    input.invocation.execution.assertActive();
    const actual = await input.describe(`media-operation-${row.id}`);
    input.invocation.execution.assertActive();
    const closed = MovieRetryClosedWorkflowV1Schema.safeParse({
      workflowId: `media-operation-${row.id}`,
      ...actual,
    });
    if (!closed.success)
      throw requestedMovieRollbackConflict(
        "An exact rollback retry is active or its Workflow is unknown",
      );
    terminal.push(participant);
  }
  return terminal;
}

function dispatchedParticipant(
  row: Awaited<ReturnType<typeof movieRollbackRetryParticipantsV1>>[number],
): ClosedMovieRollbackRetryParticipantV1 | null {
  if (row.outbox === null)
    throw new Error("Rollback retry has no actual outbox");
  if (identityHash(row.payload) !== identityHash(row.outbox.payload))
    throw new Error("Rollback retry outbox changed its exact payload");
  return row.outbox.dispatchedAt === null
    ? null
    : {
        operationId: row.id,
        payloadHash: identityHash(row.payload),
        dispatchedAt: row.outbox.dispatchedAt.toISOString(),
      };
}

export function assertClosedMovieRollbackRetryParticipantsV1(
  rows: Awaited<ReturnType<typeof movieRollbackRetryParticipantsV1>>,
  closed: readonly ClosedMovieRollbackRetryParticipantV1[],
) {
  for (const row of rows) {
    const actual = dispatchedParticipant(row);
    if (
      actual === null ||
      !closed.some(
        (observed) => identityHash(observed) === identityHash(actual),
      )
    )
      throw requestedMovieRollbackConflict(
        "An exact rollback retry is already queued or running",
      );
  }
}
