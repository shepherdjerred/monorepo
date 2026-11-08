import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { MovieRollbackHandoffExecutionV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";
import { captureMovieRollbackRetryPlaybackV1 } from "#infrastructure/movie-editions/rollback/retry/retry-playback-capture.ts";
import { commitMovieRollbackRetryPlaybackV1 } from "#infrastructure/movie-editions/rollback/retry/retry-playback-store.ts";
import { observeSessionPlayback } from "#automation/retention/sessions.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

export async function observeAutomaticMovieRollbackRetryPlaybackV1(
  context: MediaAutomationContext,
  handoff: MovieRollbackHandoffExecutionV1,
  execution: PlexBindingExecution,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  if (!(await context.gates.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [handoff.input.scope.mediaId])) ?? {},
  );
  const capture = (
    tx: Parameters<typeof captureMovieRollbackRetryPlaybackV1>[0],
  ) => captureMovieRollbackRetryPlaybackV1(tx, { handoff, access, invocation });
  const prepared = await context.db.$transaction(capture);
  if (prepared.status === "complete")
    return { status: "ready" as const, reason: null };
  const sessions = await observeSessionPlayback(
    context,
    {
      access: [prepared.originalAssociation.access],
      original: [{ association: prepared.originalAssociation }],
      paths: prepared.paths,
      budget: invocation.budget,
    },
    execution,
    prepared.freshness,
  );
  if (sessions.active || sessions.checkedAt === null)
    return { status: "blocked" as const, reason: "active_playback" };
  const configured = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [handoff.input.scope.mediaId])) ?? {},
  );
  if (identityHash(configured) !== identityHash(access))
    throw new FileGuardError("wrong_section");
  await context.db.$transaction(
    async (tx) => {
      if (!(await context.gates.acquisition()))
        throw new FileGuardError("acquisition_disabled");
      const current = await capture(tx);
      if (current.status === "complete") return;
      await commitMovieRollbackRetryPlaybackV1(tx, {
        prepared,
        current,
        sessions,
        invocation,
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  execution.assertActive();
  return { status: "ready" as const, reason: null };
}
