import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createSeedingActivities } from "#automation/seeding.ts";

export function createSeedingNetworkFacet(context: MediaAutomationContext) {
  const invocation = (
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => {
    execution.assertActive();
    return createSeedingActivities({
      ...context,
      plexBindingExecution: () => execution,
      movieManagement: { execution, budget },
    });
  };
  return {
    evaluateMediaSeeding: (
      input: Parameters<MediaNetworkActivities["evaluateMediaSeeding"]>[0],
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => invocation(execution, budget).evaluateMediaSeeding(input),
    removeMediaTorrent: (
      input: Parameters<MediaNetworkActivities["removeMediaTorrent"]>[0],
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => invocation(execution, budget).removeMediaTorrent(input),
  };
}
