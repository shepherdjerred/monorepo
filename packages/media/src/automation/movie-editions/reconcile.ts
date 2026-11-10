import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieNetworkActivitiesV4 } from "#shared/movie-editions/lifecycle/activities-v4.ts";
import {
  MovieReconcileOperationV4Schema,
  type MovieReconcileOperationV4,
  type MovieOperationV4,
  type MovieProviderSearchProgressV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { MediaError } from "#application/errors.ts";
import { ProviderAdmissionDeferred } from "#automation/providers.ts";
import {
  searchMovieCandidatesV4,
  MovieProviderSearchDeferredV4,
} from "./candidates.ts";
import { assessRetainedMovieRelease } from "./release-assessment.ts";
import { reserveMovieCandidateV4 } from "./reservation.ts";
import { resumeMovieAttempt } from "./retry/resume.ts";
import {
  readMovieRetryDispatchV4,
  dispatchMovieRetryV4,
} from "./retry/dispatch.ts";
import { movieManagementContext } from "./management-context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";

/** One coordinator retains its own scope and attempt; another cut cannot sponsor a resume. */
export async function reconcileMovieIntentV4(
  initial: MediaAutomationContext,
  raw: MovieReconcileOperationV4,
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  const context = movieManagementContext(initial);
  const { providerSearchProgress, ...input } =
    MovieReconcileOperationV4Schema.parse(raw);
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
  const retry = readMovieRetryDispatchV4(record, input);
  if (retry !== null) {
    context.movieManagement.budget.consume(1);
    return dispatchMovieRetryV4(context, {
      command: input,
      operation: record,
      selected: retry,
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
  return reserveSelectedMovie(context, input, {
    releaseId,
    epoch: runtime.epoch,
    execution,
    providerSearchProgress,
  });
}

async function reserveSelectedMovie(
  context: MediaAutomationContext,
  input: MovieOperationV4,
  options: {
    releaseId: string | undefined;
    epoch: number;
    execution: PlexBindingExecution;
    providerSearchProgress: MovieProviderSearchProgressV4 | undefined;
  },
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  const { releaseId, epoch, execution } = options;
  let selected: Awaited<ReturnType<typeof selectMovieCandidate>>;
  try {
    selected = await selectMovieCandidate(
      context,
      input,
      releaseId,
      options.providerSearchProgress,
    );
  } catch (error) {
    if (!(error instanceof ProviderAdmissionDeferred)) throw error;
    execution.assertActive();
    return {
      status: "waiting",
      attemptId: null,
      reason: "provider_deferred",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((error.retryAt.getTime() - Date.now()) / 1000),
      ),
      ...(error instanceof MovieProviderSearchDeferredV4
        ? { providerSearchProgress: error.progress }
        : {}),
    };
  }
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
    epoch,
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
  providerSearchProgress: MovieProviderSearchProgressV4 | undefined,
) {
  if (releaseId === undefined) {
    const candidates = await searchMovieCandidatesV4(context, input.scope, {
      ...input,
      ...(providerSearchProgress === undefined
        ? {}
        : { providerSearchProgress }),
    });
    return candidates[0];
  }
  const assessed = await assessRetainedMovieRelease(context, {
    scope: input.scope,
    releaseId,
  });
  return { releaseId, assessment: assessed.ref };
}
