import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import { readMovieRollbackRetryCommandV1 } from "#infrastructure/movie-editions/rollback/retry/retry-command-records.ts";
import { readMovieRollbackRetryParentV1 } from "#infrastructure/movie-editions/rollback/retry/retry-parent.ts";
import { readMovieRollbackHandoffV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-records.ts";
import { readMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { rollbackMoviePublicationV4 } from "./publication.ts";
import { rollbackRequestedMoviePublicationV1 } from "./manual-publication.ts";

/** Retry preparation acknowledges ONLY a real existing admission. It creates
 * neither another intent nor another cleanup claim or native descriptor. */
export async function prepareMovieRollbackRetryFilesV1(
  base: FileContext,
  input: MovieRollbackRetryOperationV1,
) {
  const invocation = base.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const command = await readMovieRollbackRetryCommandV1(
    base.db,
    input,
    invocation.budget,
  );
  const parent = await readMovieRollbackRetryParentV1(
    base.db,
    input,
    invocation.budget,
  );
  if (
    identityHash(command.payload.invocation) !==
    identityHash(parent.intent.invocation)
  )
    throw new Error(
      "Movie rollback retry cannot replace its original admitted source",
    );
  const completed = z
    .object({ movieRollbackPlexV1: z.unknown().optional() })
    .nullable()
    .parse(parent.operation.result)?.movieRollbackPlexV1;
  if (completed !== undefined) {
    if (
      (await readMovieRollbackPlexV1(
        base.db,
        parent.intent.invocation,
        invocation.budget,
      )) === null
    )
      throw new Error(
        "Movie rollback retry lost its actual serving completion",
      );
    invocation.execution.assertActive();
    return { status: "prepared" as const, reason: null };
  }
  const handoff = await readMovieRollbackHandoffV1(
    base.db,
    parent,
    invocation.budget,
  );
  const owner = base.movieRollbackExecution;
  if (
    handoff?.command.operation.id !== input.operationId ||
    handoff.handoff.owner.workflowId !== owner?.workflowId ||
    handoff.handoff.owner.runId !== owner.runId
  )
    return {
      status: "blocked" as const,
      reason: "movie_rollback_owner_handoff_required",
    };
  invocation.execution.assertActive();
  return { status: "prepared" as const, reason: null };
}

export async function rollbackMovieRetryPublicationV1(
  base: FileContext,
  input: MovieRollbackRetryOperationV1,
) {
  const invocation = base.movieManagement,
    owner = base.movieRollbackExecution;
  if (invocation === undefined || owner === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  const command = await readMovieRollbackRetryCommandV1(
    base.db,
    input,
    invocation.budget,
  );
  const handoff = { input, owner };
  return command.payload.invocation.mode === "automatic_failed_plex"
    ? rollbackMoviePublicationV4(
        base,
        command.payload.invocation.source,
        handoff,
      )
    : rollbackRequestedMoviePublicationV1(
        base,
        command.payload.invocation.command,
        handoff,
      );
}
