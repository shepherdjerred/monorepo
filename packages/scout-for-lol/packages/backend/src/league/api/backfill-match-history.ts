import { api } from "#src/league/api/api.ts";
import { regionToRegionGroup } from "twisted/dist/constants/regions.js";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import type {
  PlayerConfigEntry,
  LeaguePuuid,
} from "@scout-for-lol/data/index.ts";
import { updateLastMatchTime } from "#src/database/index.ts";
import { getRecentMatchIds } from "#src/league/api/match-history.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const logger = createLogger("api-backfill-match-history");

/**
 * Backfill the lastMatchTime for a newly added player.
 *
 * This fetches the player's most recent match and updates their lastMatchTime
 * in the database. This helps prevent newly added players from being stuck on
 * the 1-minute polling interval when they may be inactive.
 *
 * @param player - Player configuration entry with puuid and region
 * @param puuid - Player's PUUID for database update
 * @returns The timestamp of the most recent match, or undefined if no matches found
 */
export async function backfillLastMatchTime(
  player: PlayerConfigEntry,
  puuid: LeaguePuuid,
): Promise<Date | undefined> {
  const playerAlias = player.alias;
  const playerPuuid = player.league.leagueAccount.puuid;
  const playerRegion = player.league.leagueAccount.region;

  logger.info(
    `🔄 Backfilling match history for ${playerAlias} (${playerPuuid})`,
  );

  try {
    // Fetch most recent match ID
    const recentMatchIds = await getRecentMatchIds(player, 1);

    if (!recentMatchIds || recentMatchIds.length === 0) {
      logger.info(
        `ℹ️  No match history found for ${playerAlias}, will use MAX polling interval`,
      );
      return undefined;
    }

    const mostRecentMatchId = recentMatchIds[0];
    if (!mostRecentMatchId) {
      logger.info(
        `ℹ️  No match history found for ${playerAlias}, will use MAX polling interval`,
      );
      return undefined;
    }

    logger.info(
      `📜 Most recent match ID for ${playerAlias}: ${mostRecentMatchId}`,
    );

    // Fetch match details to get game creation time
    const region = mapRegionToEnum(playerRegion);
    const regionGroup = regionToRegionGroup(region);
    const response = await withTimeout(
      api.MatchV5.get(mostRecentMatchId, regionGroup),
    );
    const matchData = response.response;
    const gameCreationTime = new Date(matchData.info.gameCreation);

    logger.info(
      `✅ Found most recent match for ${playerAlias} at ${gameCreationTime.toISOString()}`,
    );

    // Update the database
    await updateLastMatchTime(puuid, gameCreationTime);

    return gameCreationTime;
  } catch (error) {
    logger.error(
      `❌ Error backfilling match history for ${playerAlias}:`,
      error,
    );
    return undefined;
  }
}
