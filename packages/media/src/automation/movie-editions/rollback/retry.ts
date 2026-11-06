import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { readMovieRollbackRetryCommandV1 } from "#infrastructure/movie-editions/rollback/retry-command-records.ts";
import { prepareMovieRollbackOwnerHandoffV1 } from "./retry-handoff.ts";
import { observeAutomaticMovieRollbackRetryPlaybackV1 } from "./retry-playback.ts";
import { observeRequestedMovieRollbackV1 } from "./manual-playback.ts";
import { verifyRequestedMovieRollbackV1 } from "./manual-verification.ts";
import { verifyRolledBackMoviePlexV4 } from "./verification.ts";

export async function observeRequestedMovieRollbackRetryV1(
  context: MediaAutomationContext,
  input: MovieRollbackRetryOperationV1,
  execution: PlexBindingExecution,
  owner: MovieRollbackExecution | undefined,
) {
  if (owner === undefined)
    throw new FileGuardError("movie_rollback_sdk_context_missing");
  try {
    const acquired = await prepareMovieRollbackOwnerHandoffV1(
      context,
      input,
      execution,
      owner,
    );
    if (acquired.acquired || acquired.completed)
      return { status: "ready" as const, reason: null };
    const handoff = { input, owner };
    return acquired.parent.intent.invocation.mode === "automatic_failed_plex"
      ? await observeAutomaticMovieRollbackRetryPlaybackV1(
          context,
          handoff,
          execution,
        )
      : await observeRequestedMovieRollbackV1(
          context,
          acquired.parent.intent.invocation.command,
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
