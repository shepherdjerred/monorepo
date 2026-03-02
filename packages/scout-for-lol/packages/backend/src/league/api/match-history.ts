import { api } from "#src/league/api/api.ts";
import { regionToRegionGroup } from "twisted/dist/constants/regions.js";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import type { PlayerConfigEntry, MatchId } from "@scout-for-lol/data/index.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { z } from "zod";
import {
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import * as Sentry from "@sentry/bun";

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

  try {
    const startTime = Date.now();
    const region = mapRegionToEnum(playerRegion);
    const regionGroup = regionToRegionGroup(region);

    Sentry.addBreadcrumb({
      category: "riot-api",
      message: `Fetching match history for ${playerAlias}`,
      data: { playerAlias, region: playerRegion, endpoint: "MatchV5.list" },
      level: "info",
    });

    const response = await withTimeout(
      api.MatchV5.list(playerPuuid, regionGroup, { count }),
    );

    const apiTime = Date.now() - startTime;
    riotApiRequestsTotal.inc({ source: "match-history", status: "success" });
    updateRiotApiHealth(true);

    // The response should be an ApiResponseDTO with a response property containing an array of match IDs
    const matchIdsResult = z.array(MatchIdSchema).safeParse(response.response);

    if (!matchIdsResult.success) {
      logger.error(
        `❌ Failed to parse match IDs for ${playerAlias}:`,
        matchIdsResult.error,
      );
      riotApiErrorsTotal.inc({
        source: "match-id-parsing",
        http_status: "validation",
      });
      return undefined;
    }

    const matchIds = matchIdsResult.data;
    logger.info(
      `✅ Successfully fetched ${matchIds.length.toString()} match IDs for ${playerAlias} (${apiTime.toString()}ms)`,
    );

    return matchIds;
  } catch (error) {
    riotApiRequestsTotal.inc({
      source: "match-history",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);

    const result = z.object({ status: z.number() }).safeParse(error);
    if (result.success) {
      const status = result.data.status;
      if (status === 404) {
        logger.info(`ℹ️  Player ${playerAlias} has no match history (404)`);
        return undefined;
      }
      logger.error(`❌ HTTP Error ${status.toString()} for ${playerAlias}`);
      riotApiErrorsTotal.inc({
        source: "match-history-api",
        http_status: status.toString(),
      });
      Sentry.captureException(error, {
        tags: {
          source: "match-history-api",
          playerAlias,
          region: playerRegion,
          httpStatus: status.toString(),
        },
      });
    } else {
      logger.error(
        `❌ Error fetching match history for ${playerAlias}:`,
        error,
      );
      riotApiErrorsTotal.inc({
        source: "match-history-api",
        http_status: "unknown",
      });
    }
    return undefined;
  }
}

/**
 * Filter out match IDs that have already been processed
 * Returns only new matches that come after the lastProcessedMatchId
 */
export function filterNewMatches(
  matchIds: MatchId[],
  lastProcessedMatchId: MatchId | undefined | null,
): MatchId[] {
  if (!lastProcessedMatchId) {
    // If no last processed match, return the most recent match only to avoid spam
    return matchIds.slice(0, 1);
  }

  // Find the index of the last processed match
  const lastProcessedIndex = matchIds.indexOf(lastProcessedMatchId);

  if (lastProcessedIndex === -1) {
    // Last processed match not found in recent history
    // This could happen if player played many games since last check
    // Return only the most recent match to avoid spam
    logger.info(
      `⚠️  Last processed match ${lastProcessedMatchId} not found in recent history, returning most recent match only`,
    );
    return matchIds.slice(0, 1);
  }

  if (lastProcessedIndex === 0) {
    // Last processed match is the most recent, no new matches
    return [];
  }

  // Return all matches that come before the last processed match in the array
  // (newer matches have lower indices since the API returns them in descending order)
  return matchIds.slice(0, lastProcessedIndex);
}
