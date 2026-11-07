import type { MediaAutomationContext } from "#automation/context.ts";
import { z } from "zod";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { readMovieRollbackRetryCommandV1 } from "#infrastructure/movie-editions/rollback/retry/retry-command-records.ts";
import { prepareMovieRollbackOwnerHandoffV1 } from "./retry-handoff.ts";
import { observeAutomaticMovieRollbackRetryPlaybackV1 } from "./retry-playback.ts";
import { observeRequestedMovieRollbackV1 } from "./manual-playback.ts";
import { verifyRequestedMovieRollbackV1 } from "./manual-verification.ts";
import { verifyRolledBackMoviePlexV4 } from "./verification.ts";
import { MovieRollbackHandoffRefV1Schema } from "#shared/movie-editions/rollback/handoff-reference.ts";

export async function observeRequestedMovieRollbackRetryV1(
  context: MediaAutomationContext,
  input: MovieRollbackRetryOperationV1,
  execution: PlexBindingExecution,
  owner: MovieRollbackExecution | undefined,
) {
  const invocation = context.movieManagement;
  if (owner === undefined || invocation === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  try {
    const command = await readMovieRollbackRetryCommandV1(
      context.db,
      input,
      invocation.budget,
    );
    const assigned = z
      .object({
        movieRollbackHandoffV1: MovieRollbackHandoffRefV1Schema.optional(),
      })
      .nullable()
      .parse(command.operation.result)?.movieRollbackHandoffV1;
    // This immutable command marker selects the already-owned path only. The
    // playback producer still locks and validates the actual current original
    // pointer, owner run, command and permissions before writing any evidence.
    if (assigned === undefined) {
      const acquired = await prepareMovieRollbackOwnerHandoffV1(
        context,
        input,
        execution,
        owner,
      );
      if (acquired.acquired || acquired.completed)
        return { status: "ready" as const, reason: null };
    }
    const handoff = { input, owner };
    return command.payload.invocation.mode === "automatic_failed_plex"
      ? await observeAutomaticMovieRollbackRetryPlaybackV1(
          context,
          handoff,
          execution,
        )
      : await observeRequestedMovieRollbackV1(
          context,
          command.payload.invocation.command,
          execution,
          handoff,
        );
  } catch (error) {
    execution.assertActive();
    if (error instanceof FileGuardError)
      return { status: "blocked" as const, reason: error.reason };
    if (error instanceof MediaError)
      return { status: "blocked" as const, reason: error.code };
    throw error;
  }
}

export async function verifyRequestedMovieRollbackRetryV1(
  context: MediaAutomationContext,
  input: MovieRollbackRetryOperationV1,
  execution: PlexBindingExecution,
  owner: MovieRollbackExecution | undefined,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined || owner === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  const command = await readMovieRollbackRetryCommandV1(
    context.db,
    input,
    invocation.budget,
  );
  const handoff = { input, owner };
  return command.payload.invocation.mode === "automatic_failed_plex"
    ? verifyRolledBackMoviePlexV4(
        context,
        command.payload.invocation.source,
        execution,
        handoff,
      )
    : verifyRequestedMovieRollbackV1(
        context,
        command.payload.invocation.command,
        execution,
        handoff,
      );
}
