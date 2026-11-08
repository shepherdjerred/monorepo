import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { plexBindingExecution } from "./plex-binding-execution.ts";
import { mediaCall } from "./call.ts";

type Activities = Pick<
  MediaNetworkActivities,
  "finalizeMediaAcquisition" | "deliverMediaNotification"
>;
type Runtime = {
  plexBinding: {
    [K in keyof Activities]: (
      input: Parameters<Activities[K]>[0],
      execution: PlexBindingExecution,
    ) => ReturnType<Activities[K]>;
  };
};

/** Generic Media categories and immutable receipt reads retain their existing public contracts. */
export function createPlexBoundConsumerActivities(
  load: () => Promise<Runtime>,
): Activities {
  async function call<T>(
    work: (runtime: Runtime, execution: PlexBindingExecution) => Promise<T>,
  ) {
    return mediaCall(async () => {
      const execution = plexBindingExecution();
      execution.assertActive();
      const runtime = await load();
      execution.assertActive();
      const result = await work(runtime, execution);
      execution.assertActive();
      return result;
    });
  }
  return {
    finalizeMediaAcquisition: (input) =>
      call((runtime, execution) =>
        runtime.plexBinding.finalizeMediaAcquisition(input, execution),
      ),
    deliverMediaNotification: (input) =>
      call((runtime, execution) =>
        runtime.plexBinding.deliverMediaNotification(input, execution),
      ),
  };
}
