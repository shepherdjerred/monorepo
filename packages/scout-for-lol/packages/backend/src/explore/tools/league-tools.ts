import type { DiscordAccountId } from "@scout-for-lol/data";
import { createLeagueReferenceTools } from "#src/explore/tools/league-reference-tools.ts";
import { createRiotHistoryExploreTools } from "#src/explore/tools/riot-history-tools.ts";
import { createRiotPlayerExploreTools } from "#src/explore/tools/riot-player-tools.ts";
import { createRiotTimelineExploreTools } from "#src/explore/tools/riot-timeline-tools.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/** Compose static League reference tools with policy-gated Riot reads. */
export function createLeagueExploreTools(input: {
  requesterId: DiscordAccountId;
  guildIds: string[];
  riotHistoryEnabled: boolean;
  eligibleTimelineMatchIds: () => ReadonlySet<string>;
  track: ToolTracker;
}) {
  return {
    ...createLeagueReferenceTools(input.track),
    ...(input.riotHistoryEnabled
      ? {
          ...createRiotHistoryExploreTools(input),
          ...createRiotPlayerExploreTools(input),
          ...createRiotTimelineExploreTools({
            eligibleMatchIds: input.eligibleTimelineMatchIds,
            track: input.track,
          }),
        }
      : {}),
  };
}
