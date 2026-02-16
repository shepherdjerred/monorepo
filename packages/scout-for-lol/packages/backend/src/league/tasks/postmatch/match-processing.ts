import type {
  RawMatch,
  PlayerConfigEntry,
  MatchId,
} from "@scout-for-lol/data/index.ts";
import { fetchMatchData } from "@scout-for-lol/backend/league/tasks/postmatch/match-data-fetcher.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("postmatch-match-processing");

export type PlayerWithMatchIds = {
  player: PlayerConfigEntry;
  matchIds: MatchId[];
};

export type ProcessMatchForPlayerOptions = {
  player: PlayerConfigEntry;
  matchId: MatchId;
  allPlayerConfigs: PlayerConfigEntry[];
  processedMatchIds: Set<MatchId>;
  processMatchAndUpdatePlayers: (
    matchData: RawMatch,
    allPlayerConfigs: PlayerConfigEntry[],
    processedMatchIds: Set<MatchId>,
    matchId: MatchId,
  ) => Promise<void>;
};

/**
 * Process a single match for a player
 * Extracted to reduce nesting depth
 */
export async function processMatchForPlayer(
  options: ProcessMatchForPlayerOptions,
): Promise<void> {
  const {
    player,
    matchId,
    allPlayerConfigs,
    processedMatchIds,
    processMatchAndUpdatePlayers,
  } = options;
  try {
    // Skip if we've already processed this match in this run
    if (processedMatchIds.has(matchId)) {
      logger.info(
        `[${player.alias}] ⏭️  Match ${matchId} already processed in this run`,
      );
      return;
    }

    // Fetch match data
    const matchData = await fetchMatchData(
      matchId,
      player.league.leagueAccount.region,
    );

    if (!matchData) {
      logger.info(
        `[${player.alias}] ⚠️  Could not fetch match data for ${matchId}, skipping`,
      );
      return;
    }

    // Process the match with all tracked players
    await processMatchAndUpdatePlayers(
      matchData,
      allPlayerConfigs,
      processedMatchIds,
      matchId,
    );
  } catch (error) {
    logger.error(
      `[${player.alias}] ❌ Error processing match ${matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "match-processing",
        matchId,
        playerAlias: player.alias,
      },
    });
    // Continue with next match even if this one fails
  }
}
