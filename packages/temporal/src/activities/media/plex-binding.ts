import {
  ReverifyPlexBindingInputSchema,
  ReverifyPlexBindingResultSchema,
  type PlexBindingActivities,
  type PlexBindingExecution,
  type ReverifyPlexBindingInput,
  type ReverifyPlexBindingResult,
} from "@shepherdjerred/media/plex-binding";
import { plexBindingCall } from "./plex-binding-execution.ts";

type Runtime = {
  plexBinding: {
    reverify: (
      input: ReverifyPlexBindingInput,
      execution: PlexBindingExecution,
    ) => Promise<ReverifyPlexBindingResult>;
  };
};

/** Loader injection avoids a media facade/import cycle and leaves initialization lazy. */
export function createPlexBindingNetworkActivities(
  load: () => Promise<Runtime>,
): PlexBindingActivities {
  return {
    reverifyPlexBinding: (input) =>
      plexBindingCall(async (execution) => {
        const parsed = ReverifyPlexBindingInputSchema.parse(input);
        const runtime = await load();
        execution.assertActive();
        const result = await runtime.plexBinding.reverify(parsed, execution);
        execution.assertActive();
        return ReverifyPlexBindingResultSchema.parse(result);
      }),
  };
}
