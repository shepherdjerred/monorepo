import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type {
  SportsCatalog,
  SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";

type SportsListingInput = {
  readonly scope: DiscoveryScope | null;
  readonly catalog: SportsCatalog | undefined;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
};

export async function sportsListingEvents(
  input: SportsListingInput,
): Promise<readonly SportsEvent[]> {
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
  return await input.catalog.listToday(input.signal);
}

export async function sportsListingText(
  input: SportsListingInput,
): Promise<string> {
  const events = await sportsListingEvents(input);
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
