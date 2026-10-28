import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieNetworkActivitiesV4 } from "#shared/movie-editions/activities-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { validMovieAttemptV4 } from "#automation/movie-editions/submission.ts";

export async function resumeMovieAttempt(
  context: MediaAutomationContext,
  input: MovieOperationV4,
  existing: AcquisitionAttempt,
  budget?: PublicationAuthorityReadBudget,
): ReturnType<MovieNetworkActivitiesV4["reconcileMovieIntentV4"]> {
  await readMovieAttemptIdentityV4(
    context.db,
    existing,
    input.scope,
    budget ?? context.movieManagement?.budget,
  );
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
