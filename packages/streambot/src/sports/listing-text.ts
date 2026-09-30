import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { SportsCatalog } from "@shepherdjerred/streambot/sports/types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";

export async function sportsListingText(input: {
  readonly scope: DiscoveryScope | null;
  readonly catalog: SportsCatalog | undefined;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
}): Promise<string> {
  if (
    input.scope === null ||
    input.catalog === undefined ||
    input.enabled === undefined ||
    !(await input.enabled(input.scope))
  ) {
    throw new PlaybackCommandBoundaryError(
      "Sports listings are not enabled here.",
    );
  }
  const events = await input.catalog.listToday(input.signal);
  return events.length === 0
    ? "No sports streams are listed for today."
    : events
        .slice(0, 10)
        .map(
          (event) =>
            `${sportsEventTimeLabel(event)}: ${event.title} (${event.provider})`,
        )
        .join("; ");
}
