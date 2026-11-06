import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { plexBindingCall } from "./plex-binding-execution.ts";

/** The original SDK and one100 allowance precede even a cold runtime load. */
export function createProviderFeedWorkerActivitiesV1(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "providerFeed">
  >,
): Pick<MediaNetworkActivities, "matchProviderFeedSource"> {
  return {
    matchProviderFeedSource: (input) => {
      const budget = new PublicationAuthorityReadBudget();
      return plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.providerFeed.matchProviderFeedSource(
          input,
          execution,
          budget,
        );
      });
    },
  };
}
