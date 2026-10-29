import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type { PlexEventActivities } from "@shepherdjerred/media/plex-events";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { plexBindingExecution } from "./plex-binding-execution.ts";
import { watchCall } from "./watch-execution.ts";
import { mediaCall } from "./call.ts";

type Activities = Pick<
  MediaNetworkActivities,
  "evaluateMediaRetention" | "sweepMediaWork"
> &
  PlexEventActivities;
type Runtime = {
  plexWatch: {
    [K in keyof Activities]: (
      input: Parameters<Activities[K]>[0],
      execution: PlexBindingExecution,
    ) => ReturnType<Activities[K]>;
  };
};

/** Keep each public category while carrying the original pre-lazy proof window. */
export function createPlexWatchActivities(
  load: () => Promise<Runtime>,
): Activities {
  return {
    evaluateMediaRetention: (input) =>
      mediaCall(async () => {
        const execution = plexBindingExecution();
        execution.assertActive();
        const runtime = await load();
        execution.assertActive();
        return runtime.plexWatch.evaluateMediaRetention(input, execution);
      }),
    sweepMediaWork: (input) =>
      mediaCall(async () => {
        const execution = plexBindingExecution();
        execution.assertActive();
        const runtime = await load();
        execution.assertActive();
        return runtime.plexWatch.sweepMediaWork(input, execution);
      }),
    observePlexEventHint: (input) =>
      watchCall(async () => {
        const execution = plexBindingExecution();
        execution.assertActive();
        const runtime = await load();
        execution.assertActive();
        return runtime.plexWatch.observePlexEventHint(input, execution);
      }),
  };
}
