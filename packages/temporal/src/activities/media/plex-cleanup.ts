import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { plexBindingExecution } from "./plex-binding-execution.ts";
import { mediaCall } from "./call.ts";

type Activity = MediaNetworkActivities["observeMediaUpgradeCleanup"];
type Runtime = {
  plexBinding: {
    observeMediaUpgradeCleanup: (
      input: Parameters<Activity>[0],
      execution: PlexBindingExecution,
    ) => ReturnType<Activity>;
  };
};

/** Preserve the original proof clock across lazy configuration and the purged ACK path. */
export function createPlexCleanupActivities(
  load: () => Promise<Runtime>,
): Pick<MediaNetworkActivities, "observeMediaUpgradeCleanup"> {
  return {
    observeMediaUpgradeCleanup: (input) =>
      mediaCall(async () => {
        const execution = plexBindingExecution();
        execution.assertActive();
        const runtime = await load();
        execution.assertActive();
        const result = await runtime.plexBinding.observeMediaUpgradeCleanup(
          input,
          execution,
        );
        execution.assertActive();
        return result;
      }),
  };
}
