import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { createChampionMetaTools } from "#src/explore/tools/champion-meta-tools.ts";
import type { MetaReader } from "#src/meta/meta-reader.ts";
import { publishedMetaReader } from "#src/meta/published-meta-reader.ts";
import { createLeagueReferenceTools } from "#src/explore/tools/league-reference-tools.ts";
import { createRiotHistoryExploreTools } from "#src/explore/tools/riot-history-tools.ts";
import { createRiotPlayerExploreTools } from "#src/explore/tools/riot-player-tools.ts";
import { createRiotTimelineExploreTools } from "#src/explore/tools/riot-timeline-tools.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/** Compose static League reference tools with policy-gated Riot reads. */
export function createLeagueExploreTools(input: {
  requesterId: DiscordAccountId;
  guildIds: DiscordGuildId[];
  riotHistoryEnabled: boolean;
  eligibleTimelineMatchIds: () => ReadonlySet<string>;
  track: ToolTracker;
  metaReader?: MetaReader;
  abortSignal?: AbortSignal | undefined;
}) {
  return {
    ...createLeagueReferenceTools(input.track),
    ...createChampionMetaTools({
      reader: input.metaReader ?? publishedMetaReader,
      track: input.track,
    }),
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
