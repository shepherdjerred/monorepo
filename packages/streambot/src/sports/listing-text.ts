import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type {
  SportsCatalog,
  SportsEvent,
  SportsProviderPreference,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";

type SportsListingInput = {
  readonly scope: DiscoveryScope | null;
  readonly catalog: SportsCatalog | undefined;
  readonly enabled: MediaFeatureGate["sportsStreaming"];
  readonly signal: AbortSignal;
  readonly provider?: SportsProviderPreference;
  readonly league?: string;
  readonly range?: "today" | "week";
  readonly query?: string;
  readonly lolEnabled?: MediaFeatureGate["lolEsports"];
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
  const lol = (await input.lolEnabled?.(input.scope)) === true;
  const provider =
    input.provider ??
    (input.query !== undefined ||
    input.league !== undefined ||
    input.range === "week"
      ? "lolesports"
      : "auto");
  if (provider === "lolesports") {
    if (!lol || input.catalog.listSchedule === undefined)
      throw new PlaybackCommandBoundaryError(
        "LoL Esports is not enabled here.",
      );
    return await input.catalog.listSchedule(input.signal, {
      ...(input.league === undefined ? {} : { league: input.league }),
      ...(input.range === undefined ? {} : { range: input.range }),
    });
  }
  const today = await input.catalog.listToday(input.signal, provider);
  return today.filter((e) => e.provider !== "lolesports" || lol);
}

export async function sportsListingText(
  input: SportsListingInput,
): Promise<string> {
  const events = await sportsListingEvents(input);
  const filtered =
    input.query === undefined
      ? events
      : events.filter((event) =>
          event.title
            .toLocaleLowerCase("en-US")
            .includes(input.query?.toLocaleLowerCase("en-US") ?? ""),
        );
  return filtered.length === 0
    ? "No sports streams are listed for today."
    : filtered
        .slice(0, 10)
        .map(
          (event) =>
            `${sportsEventTimeLabel(event)}: ${event.title} (${event.provider})`,
        )
        .join("; ");
}
