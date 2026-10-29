import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";

export type MovieRemovalScope = {
  scope: MovieEditionScope;
  budget: PublicationAuthorityReadBudget;
};

export function assertMovieRemovalDecision(
  decision: { mediaId: string; edition: string },
  scope: MovieEditionScope,
) {
  if (
    decision.mediaId !== scope.mediaId ||
    decision.edition !== scope.edition ||
    scope.rootMediaId !== scope.mediaId
  )
    throw new FileGuardError("decision_obsolete");
}
