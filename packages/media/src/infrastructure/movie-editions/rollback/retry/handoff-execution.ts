import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { movieChoiceSubject } from "#infrastructure/movie-editions/access.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MovieRollbackRetryParentV1 } from "./retry-context.ts";
import { readMovieRollbackHandoffV1 } from "./handoff-records.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { readMovieRollbackRetryPlaybackV1 } from "./retry-playback-records.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export async function captureMovieRollbackPlexHandoffExecutionV1(
  tx: Prisma.TransactionClient,
  parent: MovieRollbackRetryParentV1,
  input: Parameters<typeof captureMovieRollbackHandoffExecutionV1>[2],
) {
  try {
    return await captureMovieRollbackHandoffExecutionV1(tx, parent, input);
  } catch (error) {
    if (!(error instanceof FileGuardError)) throw error;
    throw new PlexBindingProtection("ownership_changed");
  }
}

/** This is input to validation, never an authority capability by construction. */
export type MovieRollbackHandoffExecutionV1 = {
  input: MovieRollbackRetryOperationV1;
  owner: MovieRollbackExecution;
};
type QueriedOwner = {
  tx: Prisma.TransactionClient;
  access: MovieChoiceAccess;
  owner: Awaited<ReturnType<typeof movieChoiceSubject>>;
};

export function movieRollbackExecutionFreshnessV1(
  invocation: MovieManagementInvocation,
  original: PlexBindingFreshness,
  handoff: Awaited<ReturnType<typeof captureMovieRollbackHandoffExecutionV1>>,
) {
  return handoff === null
    ? original
    : plexBindingFreshness({
        observed: invocation.execution.observed,
        expiresAtMs: Math.min(
          original.expiresAtMs,
          handoff.freshness.expiresAtMs,
        ),
        guards: [original, handoff.freshness],
      });
}

/** Caller holds the original Operation lock. A new handoff cannot commit while
 * this transaction applies native effects. All current original gates still
 * run independently; this adds the current retry owner's permission fence. */
export async function captureMovieRollbackHandoffExecutionV1(
  tx: Prisma.TransactionClient,
  parent: MovieRollbackRetryParentV1,
  input: {
    handoff?: MovieRollbackHandoffExecutionV1;
    invocation: MovieManagementInvocation;
    access: MovieChoiceAccess;
    phase?: "physical" | "playback" | "plex";
    queriedOwner?: QueriedOwner;
  },
) {
  const current = await readMovieRollbackHandoffV1(
    tx,
    parent,
    input.invocation.budget,
  );
  if (current === null) {
    if (input.handoff !== undefined)
      throw new FileGuardError("movie_rollback_owner_handoff_required");
    return null;
  }
  const provided = input.handoff;
  if (
    provided === undefined ||
    identityHash(provided.input) !== identityHash(current.handoff.input) ||
    provided.owner.workflowId !== current.handoff.owner.workflowId ||
    provided.owner.runId !== current.handoff.owner.runId
  )
    throw new FileGuardError("movie_rollback_execution_owner_changed");
  const owner = await currentOwner(tx, {
    actorId: current.command.payload.actorId,
    access: input.access,
    invocation: input.invocation,
    ...(input.queriedOwner === undefined
      ? {}
      : { queriedOwner: input.queriedOwner }),
  });
  if (
    owner.actor.role !== "owner" ||
    owner.actor.restricted ||
    owner.freshness === null
  )
    throw new FileGuardError("movie_rollback_current_owner_required");
  owner.freshness.assertActive();
  const execution = input.invocation.execution;
  const playback =
    input.phase === "physical" &&
    parent.intent.invocation.mode === "automatic_failed_plex"
      ? await readMovieRollbackRetryPlaybackV1(tx, {
          parent,
          handoff: current,
          invocation: input.invocation,
        })
      : null;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      owner.freshness.expiresAtMs,
      execution.observed.wall + 60_000,
      playback?.freshness.expiresAtMs ?? Number.POSITIVE_INFINITY,
    ),
    guards: [
      execution,
      owner.freshness,
      ...(playback === null ? [] : [playback.freshness]),
    ],
  });
  freshness.assertActive();
  const statement = JSON.stringify({
    schemaVersion: 1,
    operationId: parent.operation.id,
    reference: current.reference,
    input: provided.input,
    owner: provided.owner,
    observedAt: new Date(execution.observed.wall).toISOString(),
    sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
    expiresAt: new Date(freshness.expiresAtMs).toISOString(),
  });
  await tx.$queryRaw`SELECT set_config('media.movie_rollback_execution_v1',${statement},true)::text`;
  return { ...current, freshness, playback };
}

/** The original owner and retry owner may be the same person. Reuse only an
 * actual permission read held by this transaction for this configured access;
 * another actor still receives a separate locked identity/mapping read. */
async function currentOwner(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
    queriedOwner?: QueriedOwner;
  },
) {
  const queried = input.queriedOwner;
  if (
    queried !== undefined &&
    (queried.tx !== tx ||
      identityHash(queried.access) !== identityHash(input.access))
  )
    throw new Error(
      "Rollback permission reuse lost its actual transaction or access",
    );
  if (queried?.owner.actor.id === input.actorId) {
    if (queried.owner.subject.id !== input.actorId)
      throw new Error("Rollback permission reuse changed its actual subject");
    return queried.owner;
  }
  const owner = await movieChoiceSubject(tx, {
    actorId: input.actorId,
    subjectUserId: input.actorId,
    purpose: "choose",
    access: input.access,
    mediaSectionId: input.access.movieSectionId,
  });
  input.invocation.budget.consume(owner.mapping === null ? 2 : 3);
  return owner;
}
