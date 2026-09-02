import * as Sentry from "@sentry/bun";
import {
  filterNewMatches,
  getRecentMatchIds,
} from "#src/league/api/match-history.ts";
import {
  getLastProcessedMatch,
  updateLastCheckedAt,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { recoverMissedMatches } from "#src/league/tasks/postmatch/gap-recovery.ts";
import type { PlayerWithMatchIds } from "#src/league/tasks/postmatch/match-processing.ts";
import type { MatchPollAccount } from "#src/league/tasks/postmatch/match-discovery-selection.ts";
import { matchHistoryReadCount } from "#src/league/tasks/postmatch/match-discovery-selection.ts";
import { calculatePollingInterval } from "#src/utils/polling-intervals.ts";

const logger = createLogger("postmatch-match-history-collection");

async function collectNewMatchesForPlayer(
  account: MatchPollAccount,
  currentTime: Date,
  requiredForActiveDare: boolean,
): Promise<PlayerWithMatchIds | undefined> {
  const { config: player, lastMatchTime, lastCheckedAt } = account;
  const puuid = player.league.leagueAccount.puuid;
  const interval = calculatePollingInterval(lastMatchTime, currentTime);
  logger.info(
    `[${player.alias}] 🔍 Checking match history (interval: ${interval.toString()}min, last match: ${lastMatchTime ? lastMatchTime.toISOString() : "never"}, last checked: ${lastCheckedAt ? lastCheckedAt.toISOString() : "never"})`,
  );

  const lastProcessedMatchId = await getLastProcessedMatch(puuid);
  // A mandatory Dare target must retain the whole contract evidence bound.
  // Otherwise games that finish after this poll's watermark can crowd older,
  // still-unobserved evidence out of the ordinary five-match history read.
  const recentMatchIds = await getRecentMatchIds(
    player,
    matchHistoryReadCount(requiredForActiveDare),
  );
  if (recentMatchIds === undefined) {
    throw new Error(`Match history is unavailable for ${puuid}`);
  }
  await updateLastCheckedAt(puuid, currentTime);
  if (recentMatchIds.length === 0) {
    logger.info(`[${player.alias}] ℹ️  No recent matches found`);
    return;
  }

  const { matchIds: newMatchIds, gapDetected } = filterNewMatches(
    recentMatchIds,
    lastProcessedMatchId,
  );
  if (newMatchIds.length === 0) {
    logger.info(`[${player.alias}] ✅ No new matches to process`);
    return;
  }

  const recovered = gapDetected
    ? await recoverMissedMatches(
        player,
        newMatchIds,
        requiredForActiveDare,
        lastProcessedMatchId,
        account.lastMatchTime,
      )
    : { discordMatchIds: newMatchIds, backfillMatchIds: [] };
  logger.info(
    `[${player.alias}] 🆕 Found ${recovered.discordMatchIds.length.toString()} new match(es) for Discord: ${recovered.discordMatchIds.join(", ")}`,
  );
  return {
    player,
    matchIds: recovered.discordMatchIds,
    backfillMatchIds: recovered.backfillMatchIds,
  };
}

export async function collectNewMatches(input: {
  playersToCheck: MatchPollAccount[];
  currentTime: Date;
  requiredDarePuuids: ReadonlySet<string>;
}): Promise<{
  complete: boolean;
  playersWithMatches: PlayerWithMatchIds[];
}> {
  const playersWithMatches: PlayerWithMatchIds[] = [];

  for (const account of input.playersToCheck) {
    const player = account.config;
    const puuid = player.league.leagueAccount.puuid;
    try {
      const matches = await collectNewMatchesForPlayer(
        account,
        input.currentTime,
        input.requiredDarePuuids.has(puuid),
      );
      if (matches !== undefined) playersWithMatches.push(matches);
    } catch (error) {
      logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
      Sentry.captureException(error, {
        tags: {
          source: "match-history-check",
          playerAlias: player.alias,
          puuid,
        },
      });
      if (input.requiredDarePuuids.has(puuid)) {
        return { complete: false, playersWithMatches: [] };
      }
    }
  }

  return { complete: true, playersWithMatches };
}
