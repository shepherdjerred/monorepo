import type { MediaAutomationContext } from "#automation/context.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** One immutable capability/budget per Activity, shared by nested search, reservation and effect reads. */
export function movieManagementContext(initial: MediaAutomationContext) {
  const execution =
    initial.movieManagement?.execution ?? initial.plexBindingExecution();
  return {
    ...initial,
    plexBindingExecution: () => execution,
    movieManagement: initial.movieManagement ?? {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
}
