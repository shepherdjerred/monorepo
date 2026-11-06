import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { plexBindingCall } from "./plex-binding-execution.ts";

/** Capture the original SDK and one provenance allowance before even a cold runtime await. */
export function createSeedingWorkerActivities(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "seeding">
  >,
): Pick<MediaNetworkActivities, "evaluateMediaSeeding" | "removeMediaTorrent"> {
  return {
    evaluateMediaSeeding: (input) => {
      const budget = new PublicationAuthorityReadBudget();
      return plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.seeding.evaluateMediaSeeding(input, execution, budget);
      });
    },
    removeMediaTorrent: (input) => {
      const budget = new PublicationAuthorityReadBudget();
      return plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.seeding.removeMediaTorrent(input, execution, budget);
      });
    },
  };
}
