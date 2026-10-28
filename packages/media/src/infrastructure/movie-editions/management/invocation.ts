import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Process-local capability shared by scoped movie effects; never stored or serialized. */
export type MovieManagementInvocation = {
  execution: PlexBindingExecution;
  budget: PublicationAuthorityReadBudget;
};
