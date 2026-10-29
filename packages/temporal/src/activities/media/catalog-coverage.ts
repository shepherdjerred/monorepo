import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { plexBindingCall } from "./plex-binding-execution.ts";

export function createCatalogCoverageWorkerActivities(
  load: () => Promise<
    Pick<
      Awaited<ReturnType<typeof createMediaNetworkRuntime>>,
      "catalogCoverage"
    >
  >,
): Pick<MediaNetworkActivities, "expandCatalogRequests"> {
  return {
    expandCatalogRequests: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.catalogCoverage.expandCatalogRequests(input, execution);
      }),
  };
}
