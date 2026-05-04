import { api } from "#src/league/api/api.ts";
import { regionToRegionGroup } from "twisted/dist/constants/regions.js";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import type { PlayerConfigEntry, MatchId } from "@scout-for-lol/data/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";

const logger = createLogger("api-match-history");

/**
 * Fetch recent match IDs for a player
 * Returns up to `count` most recent match IDs
 */
export async function getRecentMatchIds(
  player: PlayerConfigEntry,
  count = 5,
): Promise<MatchId[] | undefined> {
  const playerAlias = player.alias;
  const playerPuuid = player.league.leagueAccount.puuid;
  const playerRegion = player.league.leagueAccount.region;

  logger.info(
    `📜 Fetching recent match IDs for player: ${playerAlias} (${playerPuuid}) in region ${playerRegion}`,
  );

  const region = mapRegionToEnum(playerRegion);
  const regionGroup = regionToRegionGroup(region);

  return callRiotOrUndefined(
    {
      source: "match-history",
      schema: z.array(MatchIdSchema),
      context: { playerAlias, region: playerRegion },
      sentry: true,
    },
    () => api.MatchV5.list(playerPuuid, regionGroup, { count }),
  );
}

export type FilterResult = {
  matchIds: MatchId[];
  gapDetected: boolean;
};

/**
 * Filter out match IDs that have already been processed
 * Returns only new matches that come after the lastProcessedMatchId
 * When lastProcessedMatchId is not found in recent history, sets gapDetected: true
 */
export function filterNewMatches(
  matchIds: MatchId[],
  lastProcessedMatchId?: MatchId | null,
): FilterResult {
  if (matchIds.length === 0) {
    return { matchIds: [], gapDetected: false };
  }

  if (!lastProcessedMatchId) {
    // If no last processed match, return the most recent match only to avoid spam
    return { matchIds: matchIds.slice(0, 1), gapDetected: false };
  }

  // Find the index of the last processed match
  const lastProcessedIndex = matchIds.indexOf(lastProcessedMatchId);

  if (lastProcessedIndex === -1) {
    // Last processed match not found in recent history
    // This could happen if player played many games since last check (downtime gap)
    logger.info(
      `⚠️  Last processed match ${lastProcessedMatchId} not found in recent history, gap detected`,
    );
    return { matchIds, gapDetected: true };
  }

  if (lastProcessedIndex === 0) {
    // Last processed match is the most recent, no new matches
    return { matchIds: [], gapDetected: false };
  }

  // Return all matches that come before the last processed match in the array
  // (newer matches have lower indices since the API returns them in descending order)
  return {
    matchIds: matchIds.slice(0, lastProcessedIndex),
    gapDetected: false,
  };
}
