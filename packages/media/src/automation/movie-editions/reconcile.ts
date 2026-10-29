import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieNetworkActivitiesV4 } from "#shared/movie-editions/activities-v4.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { MediaError } from "#application/errors.ts";
import { searchMovieCandidatesV4 } from "./candidates.ts";
import { assessRetainedMovieRelease } from "./release-assessment.ts";
import { reserveMovieCandidateV4 } from "./reservation.ts";
import { resumeMovieAttempt } from "./retry/resume.ts";
import {
  readMovieRetryCaptureV1,
  reconcileMovieRetryV4,
} from "./retry/recovery.ts";
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
  const retry = readMovieRetryCaptureV1(record.payload);
  if (retry !== null) {
    context.movieManagement.budget.consume(1);
    return reconcileMovieRetryV4(context, {
      command: input,
      operation: record,
      capture: retry,
    });
  }
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
