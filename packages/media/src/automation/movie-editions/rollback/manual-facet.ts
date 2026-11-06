import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { RequestedMovieRollbackInputV1 } from "#shared/movie-editions/rollback/retry.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import { observeRequestedMovieRollbackV1 } from "./manual-playback.ts";
import { verifyRequestedMovieRollbackV1 } from "./manual-verification.ts";
import {
  observeRequestedMovieRollbackRetryV1,
  verifyRequestedMovieRollbackRetryV1,
} from "./retry.ts";

export function createRequestedMovieRollbackNetworkFacetV1(
  base: MediaAutomationContext,
) {
  const invocation = (
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => ({
    ...base,
    plexBindingExecution: () => execution,
    movieManagement: { execution, budget },
  });
  return {
    observeRequestedMovieRollbackV1: (
      input: RequestedMovieRollbackInputV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
      owner?: MovieRollbackExecution,
    ) =>
      "resume" in input
        ? observeRequestedMovieRollbackRetryV1(
            invocation(execution, budget),
            input,
            execution,
            owner,
          )
        : observeRequestedMovieRollbackV1(
            invocation(execution, budget),
            input,
            execution,
          ),
    verifyRequestedMovieRollbackV1: (
      input: RequestedMovieRollbackInputV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
      owner?: MovieRollbackExecution,
    ) =>
      "resume" in input
        ? verifyRequestedMovieRollbackRetryV1(
            invocation(execution, budget),
            input,
            execution,
            owner,
          )
        : verifyRequestedMovieRollbackV1(
            invocation(execution, budget),
            input,
            execution,
          ),
  };
}
