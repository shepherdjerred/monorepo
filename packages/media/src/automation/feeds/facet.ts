import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { matchProviderFeedSourceV1 } from "./matching.ts";

/** One process-local SDK capability and allowance reach every selected feed target. */
export function createProviderFeedNetworkFacetV1(
  context: MediaAutomationContext,
) {
  return {
    matchProviderFeedSource: (
      input: Parameters<MediaNetworkActivities["matchProviderFeedSource"]>[0],
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => {
      execution.assertActive();
      return matchProviderFeedSourceV1(
        {
          ...context,
          plexBindingExecution: () => execution,
          movieManagement: { execution, budget },
        },
        input,
      );
    },
  };
}
