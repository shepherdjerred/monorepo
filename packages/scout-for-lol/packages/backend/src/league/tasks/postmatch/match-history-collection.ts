import * as Sentry from "@sentry/bun";
import {
  filterNewMatches,
  getRecentMatchIds,
} from "#src/league/api/match-history.ts";
import {
  getLastProcessedMatch,
  updateLastCheckedAt,
} from "#src/database/account-cursors.ts";
import { createLogger } from "#src/logger.ts";
import { recoverMissedMatches } from "#src/league/tasks/postmatch/gap-recovery.ts";
import type {
  RiotMatchId,
  PlayerConfigEntry,
} from "@scout-for-lol/data/index.ts";
import {
  type MatchPollAccount,
  matchHistoryReadCount,
} from "#src/league/tasks/postmatch/match-discovery-selection.ts";
import { calculatePollingInterval } from "#src/utils/polling-intervals.ts";
import { scoutMatchHistoryUnavailableTotal } from "#src/metrics/match-history.ts";

const logger = createLogger("postmatch-match-history-collection");

export type PlayerWithMatchIds = {
  player: PlayerConfigEntry;
  matchIds: RiotMatchId[];
  backfillMatchIds: RiotMatchId[];
};

/**
 * `unavailable` means Riot gave no answer for this player. The Riot call has
 * already recorded why; the player stays unchecked for the next poll.
 */
type PlayerCollection =
  | { kind: "unavailable" }
  | { kind: "checked"; matches: PlayerWithMatchIds | undefined };

async function collectNewMatchesForPlayer(
  account: MatchPollAccount,
  currentTime: Date,
  requiredForActiveDare: boolean,
): Promise<PlayerCollection> {
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
  if (recentMatchIds === undefined) return { kind: "unavailable" };
  await updateLastCheckedAt(puuid, currentTime);
  if (recentMatchIds.length === 0) {
    logger.info(`[${player.alias}] ℹ️  No recent matches found`);
    return { kind: "checked", matches: undefined };
  }

  const { matchIds: newMatchIds, gapDetected } = filterNewMatches(
    recentMatchIds,
    lastProcessedMatchId,
  );
  if (newMatchIds.length === 0) {
    logger.info(`[${player.alias}] ✅ No new matches to process`);
    return { kind: "checked", matches: undefined };
  }

  const recovered = gapDetected
    ? await recoverMissedMatches({
        player,
        fallbackMatchIds: newMatchIds,
        requiredForActiveDare,
        lastProcessedMatchId,
        lastProcessedMatchTime: account.lastMatchTime,
      })
    : { discordMatchIds: newMatchIds, backfillMatchIds: [] };
  logger.info(
    `[${player.alias}] 🆕 Found ${recovered.discordMatchIds.length.toString()} new match(es) for Discord: ${recovered.discordMatchIds.join(", ")}`,
  );
  return {
    kind: "checked",
    matches: {
      player,
      matchIds: recovered.discordMatchIds,
      backfillMatchIds: recovered.backfillMatchIds,
    },
  };
}

/**
 * Check one player. `answered: false` means this poll learned nothing for
 * them: expected unavailability is counted, anything else is reported.
 */
async function checkPlayer(
  account: MatchPollAccount,
  currentTime: Date,
  requiredForActiveDare: boolean,
): Promise<
  | { answered: false }
  | { answered: true; matches: PlayerWithMatchIds | undefined }
> {
  const player = account.config;
  try {
    const collection = await collectNewMatchesForPlayer(
      account,
      currentTime,
      requiredForActiveDare,
    );
    if (collection.kind === "checked") {
      return { answered: true, matches: collection.matches };
    }
    logger.warn(
      `[${player.alias}] ⏭️  Match history is unavailable; leaving the player unchecked for the next poll`,
    );
    scoutMatchHistoryUnavailableTotal.inc({
      dare_required: requiredForActiveDare ? "true" : "false",
    });
  } catch (error) {
    logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "match-history-check",
        playerAlias: player.alias,
        puuid: player.league.leagueAccount.puuid,
      },
    });
  }
  return { answered: false };
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
    const requiredForActiveDare = input.requiredDarePuuids.has(
      account.config.league.leagueAccount.puuid,
    );
    const check = await checkPlayer(
      account,
      input.currentTime,
      requiredForActiveDare,
    );
    if (!check.answered) {
      // An active Dare's evidence bound cannot be judged without this player.
      if (requiredForActiveDare) {
        return { complete: false, playersWithMatches: [] };
      }
      continue;
    }
    if (check.matches !== undefined) playersWithMatches.push(check.matches);
  }

  return { complete: true, playersWithMatches };
}
