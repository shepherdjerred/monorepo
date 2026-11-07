import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieRollbackOperationV1Schema,
  type MovieRollbackOperationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { captureRequestedMovieRollbackPlaybackV1 } from "#infrastructure/movie-editions/rollback/manual/manual-playback-context.ts";
import { commitRequestedMovieRollbackPlaybackV1 } from "#infrastructure/movie-editions/rollback/manual/manual-playback-store.ts";
import { verifyMoviePlexV2 } from "#automation/movie-editions/plex-verification.ts";
import { observeSessionPlayback } from "#automation/retention/sessions.ts";
import type { MovieRollbackHandoffExecutionV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";

/** Sessions are observed last, within the original Network invocation. Files
 * receives an immutable phase-specific observation and cannot renew it. */
export async function observeRequestedMovieRollbackV1(
  base: MediaAutomationContext,
  raw: MovieRollbackOperationV1,
  execution: PlexBindingExecution,
  takeover?: MovieRollbackHandoffExecutionV1,
): Promise<{
  status: "ready" | "blocked" | "obsolete";
  reason: string | null;
}> {
  execution.assertActive();
  execution.signal.throwIfAborted();
  const initial = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const context = {
    ...initial,
    movieManagement: { ...initial.movieManagement, execution },
  };
  const input = MovieRollbackOperationV1Schema.parse(raw);
  const invocation = context.movieManagement;
  try {
    if (!(await context.gates.acquisition()))
      return { status: "blocked", reason: "acquisition_disabled" };
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    const capture = (
      tx: Parameters<typeof captureRequestedMovieRollbackPlaybackV1>[0],
    ) =>
      captureRequestedMovieRollbackPlaybackV1(tx, {
        input,
        access,
        invocation,
        ...(takeover === undefined ? {} : { handoff: takeover }),
      });
    const prepared = await context.db.$transaction(capture);
    if (prepared.status === "complete")
      return { status: "ready", reason: null };
    const verified =
      prepared.expected === null
        ? null
        : await verifyMoviePlexV2(
            context,
            {
              purpose: "current_serving",
              expected: prepared.expected,
              canonicalTargets: prepared.canonicalTargets,
              access: prepared.expected.access,
              observed: execution.observed,
              expiresAtMs: prepared.freshness.expiresAtMs,
              guards: [prepared.freshness],
            },
            execution,
          );
    if (verified !== null && "status" in verified)
      return { status: "blocked", reason: verified.reason };
    const sessions = await observeSessionPlayback(
      context,
      {
        access: [prepared.association.access],
        original: [{ association: prepared.association }],
        paths: prepared.paths,
        budget: invocation.budget,
      },
      execution,
      prepared.freshness,
    );
    if (sessions.active || sessions.checkedAt === null)
      return { status: "blocked", reason: "active_playback" };
    const configured = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    if (identityHash(configured) !== identityHash(access))
      throw new FileGuardError("wrong_section");
    await context.db.$transaction(
      async (tx) => {
        if (!(await context.gates.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        const current = await capture(tx);
        if (current.status === "complete") return;
        await commitRequestedMovieRollbackPlaybackV1(tx, {
          prepared,
          current,
          verified,
          sessions,
          invocation,
        });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    execution.assertActive();
    return { status: "ready", reason: null };
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (error instanceof MediaError)
      return { status: "obsolete", reason: error.code };
    if (error instanceof FileGuardError)
      return { status: "blocked", reason: error.reason };
    if (error instanceof PlexBindingProtection)
      return { status: "blocked", reason: error.reason };
    throw error;
  }
}
