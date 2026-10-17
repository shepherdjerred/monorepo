import type { PlexEventActivities } from "@shepherdjerred/media/plex-events";
import { getMediaNetworkRuntime } from "#activities/media.ts";
import { watchCall } from "./watch-execution.ts";

export const plexEventNetworkActivities: PlexEventActivities = {
  observePlexEventHint: (input) =>
    watchCall(async () => {
      const runtime = await getMediaNetworkRuntime();
      return await runtime.activities.observePlexEventHint(input);
    }),
};
