import type { AddEventPayload } from "@shepherdjerred/streambot/machine/types.ts";
import type { QueuedDisplay } from "@shepherdjerred/streambot/metadata/queued-display.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";

export function queuedDisplay(event: AddEventPayload): QueuedDisplay {
  if (event.display !== undefined) return event.display;
  const resolved = event.preResolved;
  const thumbnailUrl = resolved?.provenance?.thumbnailUrl;
  return {
    title: resolved?.title ?? sourceLabel(event.source),
    ...(thumbnailUrl === undefined || !isRemoteArtworkUrl(thumbnailUrl)
      ? {}
      : { thumbnailUrl }),
    ...(resolved?.durationSeconds === undefined
      ? {}
      : { durationSeconds: resolved.durationSeconds }),
  };
}
