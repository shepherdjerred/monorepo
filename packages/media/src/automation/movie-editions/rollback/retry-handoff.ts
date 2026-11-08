import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { captureMovieRollbackHandoffV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-capture.ts";
import { grantMovieRollbackOwnerV1 } from "#infrastructure/movie-editions/rollback/retry/handoff-store.ts";
import { movieRetryTerminalV1 } from "#automation/movie-editions/retry/terminal.ts";
import { observeMovieRollbackClosedOwnerV1 } from "./closed-owner.ts";

/** First retry observation hands over execution. Its Files preparation only
 * ACKs the existing admission; the second observation must prove playback. */
export async function prepareMovieRollbackOwnerHandoffV1(
  context: MediaAutomationContext,
  input: MovieRollbackRetryOperationV1,
  execution: PlexBindingExecution,
  owner: MovieRollbackExecution,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  execution.assertActive();
  if (!(await context.gates.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  const capture = (tx: Parameters<typeof captureMovieRollbackHandoffV1>[0]) =>
    captureMovieRollbackHandoffV1(tx, { input, owner, access, invocation });
  const prepared = await context.db.$transaction(capture);
  if (prepared.status !== "prepared")
    return {
      acquired: false,
      completed: prepared.status === "completed",
      parent: prepared.parent,
      command: prepared.command,
    };
  const closed = await observePrevious(context, prepared, execution);
  prepared.freshness.assertActive();
  if (closed.state !== "closed")
    throw new FileGuardError("movie_rollback_previous_workflow_not_closed");
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
      if (current.status !== "prepared") return;
      if (
        current.parent.intentHash !== prepared.parent.intentHash ||
        identityHash(current.captured.expected) !==
          identityHash(prepared.captured.expected)
      )
        throw new FileGuardError("movie_rollback_handoff_review_changed");
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          prepared.freshness.expiresAtMs,
          current.freshness.expiresAtMs,
        ),
        guards: [prepared.freshness, current.freshness],
      });
      await grantMovieRollbackOwnerV1(tx, {
        ...current,
        invocation,
        owner,
        closed,
        freshness,
        writerExpiresAtMs: current.writerExpiresAtMs,
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  execution.assertActive();
  return {
    acquired: true,
    completed: false,
    parent: prepared.parent,
    command: prepared.command,
  };
}

async function observePrevious(
  context: MediaAutomationContext,
  prepared: Extract<
    Awaited<ReturnType<typeof captureMovieRollbackHandoffV1>>,
    { status: "prepared" }
  >,
  execution: PlexBindingExecution,
) {
  const previous = prepared.captured.handoff?.handoff.owner;
  if (
    previous !== undefined ||
    prepared.parent.intent.invocation.mode === "manual_verified"
  )
    return observeMovieRollbackClosedOwnerV1(
      context.describeWorkflow,
      prepared.parent.intent,
      { execution, ...(previous === undefined ? {} : { owner: previous }) },
    );
  const source = prepared.parent.intent.invocation.source;
  const actual = await movieRetryTerminalV1(
    context,
    {
      attemptId: source.attemptId,
      previousCoordinatorOperationId: source.operationId,
      reservedWithoutTorrent: false,
    },
    execution,
  );
  return actual?.child?.runId === prepared.parent.intent.owner.runId &&
    actual.child.workflowId === prepared.parent.intent.owner.workflowId
    ? { state: "closed" as const, owner: actual.child, sourceRoot: actual.root }
    : { state: "unknown" as const };
}
