import type { FileContext } from "#automation/files/types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { RequestedMovieRollbackInputV1 } from "#shared/movie-editions/rollback/retry.ts";
import { prepareRequestedMovieRollbackV1 } from "./manual-preparation.ts";
import { rollbackRequestedMoviePublicationV1 } from "./manual-publication.ts";
import {
  prepareMovieRollbackRetryFilesV1,
  rollbackMovieRetryPublicationV1,
} from "./retry.ts";

/** The worker supplies its original SDK owner and budget before runtime load. */
export function createRequestedMovieRollbackFileFacetV1(base: FileContext) {
  function invocation(
    execution: PublicationExecution,
    owner: MovieRollbackExecution,
    budget: PublicationAuthorityReadBudget,
  ): FileContext {
    return {
      ...base,
      publicationExecution: () => execution,
      movieRollbackExecution: owner,
      movieManagement: { execution, budget },
    };
  }
  return {
    prepareRequestedMovieRollbackV1: (
      input: RequestedMovieRollbackInputV1,
      execution: PublicationExecution,
      owner: MovieRollbackExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      "resume" in input
        ? prepareMovieRollbackRetryFilesV1(
            invocation(execution, owner, budget),
            input,
          )
        : prepareRequestedMovieRollbackV1(
            invocation(execution, owner, budget),
            input,
          ),
    rollbackRequestedMoviePublicationV1: (
      input: RequestedMovieRollbackInputV1,
      execution: PublicationExecution,
      owner: MovieRollbackExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      "resume" in input
        ? rollbackMovieRetryPublicationV1(
            invocation(execution, owner, budget),
            input,
          )
        : rollbackRequestedMoviePublicationV1(
            invocation(execution, owner, budget),
            input,
          ),
  };
}
