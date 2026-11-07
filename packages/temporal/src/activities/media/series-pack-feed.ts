import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { plexBindingCall } from "./plex-binding-execution.ts";

/** Current pack interpretation owns one original allowance before loading the cached runtime. */
export function createSeriesPackFeedWorkerActivities(
  load: () => Promise<
    Pick<
      Awaited<ReturnType<typeof createMediaNetworkRuntime>>,
      "seriesPackFeed"
    >
  >,
): Pick<MediaNetworkActivities, "matchSeriesPackFeedSource"> {
  return {
    matchSeriesPackFeedSource: (input) => {
      const budget = new PublicationAuthorityReadBudget();
      return plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.seriesPackFeed.matchSeriesPackFeedSource(
          input,
          execution,
          budget,
        );
      });
    },
  };
}
