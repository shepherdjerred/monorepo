import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieNetworkActivitiesV4 } from "#shared/movie-editions/activities-v4.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { MediaError } from "#application/errors.ts";
import { searchMovieCandidatesV4 } from "./candidates.ts";
import { assessRetainedMovieRelease } from "./release-assessment.ts";
import { reserveMovieCandidateV4 } from "./reservation.ts";
import { validMovieAttemptV4 } from "./submission.ts";
import { movieManagementContext } from "./management-context.ts";

/** One coordinator retains its own scope and attempt; another cut cannot sponsor a resume. */
export async function reconcileMovieIntentV4(
  initial: MediaAutomationContext,
  raw: MovieOperationV4,
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  const context = movieManagementContext(initial);
  const input = MovieOperationV4Schema.parse(raw);
  const execution = context.plexBindingExecution();
  execution.assertActive();
  const record = await context.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const { recoveryEpoch, releaseId } = z
    .object({
      recoveryEpoch: z.int().nonnegative(),
      releaseId: z.uuid().optional(),
    })
    .parse(record.payload);
  const coordinator = await assertMovieAcquisitionOperationV4(
    context.db,
    input.operationId,
    input.scope,
    recoveryEpoch,
  );
  if (coordinator.input.generation !== input.generation)
    throw new MediaError(
      "identity_scope_changed",
      "Movie coordinator generation changed",
      409,
    );
  const existing = await context.db.acquisitionAttempt.findUnique({
    where: { operationId: input.operationId },
  });
  if (existing !== null) {
    return resumeMovieAttempt(context, input, existing);
  }
  if (["completed", "failed"].includes(record.status))
    return {
      status: "obsolete",
      attemptId: null,
      reason: "operation_terminal",
    };
  const target = await context.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: input.mediaId, edition: input.scope.edition },
    },
    include: { media: true },
  });
  if (
    target.media.kind !== "movie" ||
    target.editionRootId !== input.scope.rootMediaId
  )
    throw new Error("Movie coordinator lost its canonical target");
  if (
    target.generation !== input.generation ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null
  )
    return { status: "obsolete", attemptId: null, reason: "intent_changed" };
  const runtime = await runtimeAuthority(context.db);
  if (
    !runtime.active ||
    runtime.epoch !== recoveryEpoch ||
    target.automationEpoch !== runtime.epoch ||
    !(await context.gates.acquisition())
  )
    return {
      status: "blocked",
      attemptId: null,
      reason: "acquisition_disabled",
    };
  if (target.profileId === null)
    return {
      status: "blocked",
      attemptId: null,
      reason: "quality_profile_required",
    };
  const removal = await context.db.retentionDecision.count({
    where: {
      mediaId: input.mediaId,
      edition: input.scope.edition,
      state: { in: ["warning_pending", "grace_period", "quarantined"] },
    },
  });
  if (removal > 0)
    return {
      status: "waiting",
      attemptId: null,
      reason: "retention_in_progress",
    };
  const selected = await selectMovieCandidate(context, input, releaseId);
  execution.assertActive();
  if (selected === undefined)
    return {
      status: "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    };
  const attemptId = await reserveMovieCandidateV4(
    context,
    input,
    selected,
    runtime.epoch,
  );
  execution.assertActive();
  return {
    status: attemptId === null ? "waiting" : "acquire",
    attemptId,
    reason: attemptId === null ? "reservation_unavailable" : null,
  };
}

async function selectMovieCandidate(
  context: MediaAutomationContext,
  input: MovieOperationV4,
  releaseId: string | undefined,
) {
  if (releaseId === undefined) {
    const candidates = await searchMovieCandidatesV4(context, input.scope);
    return candidates[0];
  }
  const assessed = await assessRetainedMovieRelease(context, {
    scope: input.scope,
    releaseId,
  });
  return { releaseId, assessment: assessed.ref };
}

async function resumeMovieAttempt(
  context: MediaAutomationContext,
  input: MovieOperationV4,
  existing: AcquisitionAttempt,
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  await readMovieAttemptIdentityV4(context.db, existing, input.scope);
  if (existing.coordinatorOperationId !== input.operationId)
    return {
      status: "obsolete",
      attemptId: null,
      reason: "coordinator_changed",
    };
  if (["imported", "completed"].includes(existing.state))
    return {
      status: "acquire",
      attemptId: existing.id,
      reason: "resume_committed_publication",
    };
  if (["cancelled", "failed"].includes(existing.state))
    return { status: "obsolete", attemptId: null, reason: "attempt_terminal" };
  // Ambiguous adds reconcile their actual external outcome before current demand.
  if (
    ["submitting", "submission_unknown"].includes(existing.state) ||
    (await validMovieAttemptV4(context, {
      schemaVersion: 4,
      operationId: input.operationId,
      attemptId: existing.id,
      scope: input.scope,
    }))
  )
    return { status: "acquire", attemptId: existing.id, reason: null };
  return {
    status: existing.filePlan === null ? "obsolete" : "blocked",
    attemptId: null,
    reason:
      existing.filePlan === null
        ? "intent_changed"
        : "movie_publication_reconciliation_required",
  };
}
