import type { PlexEventActivities } from "@shepherdjerred/media/plex-events";
import { getMediaNetworkRuntime } from "#activities/media.ts";
import { createPlexWatchActivities } from "./plex-watch.ts";

export const plexEventNetworkActivities: PlexEventActivities = {
  observePlexEventHint: (input) =>
    createPlexWatchActivities(getMediaNetworkRuntime).observePlexEventHint(
      input,
    ),
};
