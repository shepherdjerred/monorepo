import type { MatchId, PlayerConfigEntry } from "@scout-for-lol/data/index.ts";
import { getLastSuccessfulPollAt } from "#src/league/tasks/recovery/app-state.ts";
import { fetchMatchIdsForTimeRange } from "#src/league/tasks/recovery/backfill-to-s3.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("postmatch-gap-recovery");

export type GapRecoveryResult = {
  discordMatchIds: MatchId[];
  backfillMatchIds: MatchId[];
};

export function recoveryStartAt(input: {
  requiredForActiveDare: boolean;
  lastProcessedMatchTime: Date | undefined;
  lastSuccessfulPollAt: Date | undefined;
  puuid: string;
}): Date | undefined {
  if (input.requiredForActiveDare) {
    if (input.lastProcessedMatchTime === undefined) {
      throw new Error(
        `Cannot recover required Dare history for ${input.puuid} without an ingestion-backed cursor timestamp`,
      );
    }
    return input.lastProcessedMatchTime;
  }
  return input.lastProcessedMatchTime ?? input.lastSuccessfulPollAt;
}

/**
 * When a gap is detected (lastProcessedMatchId not in recent history),
 * fetch all missed matches via paginated time-range API and split into
 * Discord (most recent) and backfill (rest, oldest first) buckets.
 */
export async function recoverMissedMatches(
  player: PlayerConfigEntry,
  fallbackMatchIds: MatchId[],
  requiredForActiveDare: boolean,
  lastProcessedMatchId: MatchId | null,
  lastProcessedMatchTime: Date | undefined,
): Promise<GapRecoveryResult> {
  const puuid = player.league.leagueAccount.puuid;
  const lastPollAt = await getLastSuccessfulPollAt();

  const recoveryStart = recoveryStartAt({
    requiredForActiveDare,
    lastProcessedMatchTime,
    lastSuccessfulPollAt: lastPollAt ?? undefined,
    puuid,
  });

  if (!recoveryStart) {
    // No lastPollAt — first startup, just process the most recent
    return {
      discordMatchIds: fallbackMatchIds.slice(0, 1),
      backfillMatchIds: [],
    };
  }

  const startEpoch = Math.floor(recoveryStart.getTime() / 1000);
  const endEpoch = Math.floor(Date.now() / 1000);

  logger.info(
    `[${player.alias}] 🔄 Gap detected, fetching all missed matches since ${recoveryStart.toISOString()}`,
  );

  const allMissedMatchIds = await fetchMatchIdsForTimeRange(
    puuid,
    player.league.leagueAccount.region,
    startEpoch,
    endEpoch,
    { requireComplete: requiredForActiveDare },
  );

  const missedMatchIds = allMissedMatchIds.filter(
    (matchId) => matchId !== lastProcessedMatchId,
  );
  const mostRecent = missedMatchIds[0];
  if (!mostRecent) {
    // No matches in the time window — player has been inactive but the
    // cursor is stuck on a match outside the recent 5. Don't fire a Discord
    // alert on the stale fallback match (could be hours/days old). Send it
    // through silent backfill so the cursor advances and we stop detecting a
    // gap every minute.
    logger.info(
      `[${player.alias}] 🛑 No matches in time window; sending fallback to silent backfill to advance cursor`,
    );
    return {
      discordMatchIds: [],
      backfillMatchIds: fallbackMatchIds.slice(0, 1),
    };
  }

  // Most recent match (index 0) gets Discord notification
  const discordMatchIds = [mostRecent];
  // Rest are backfill-only (reversed to process oldest first)
  const backfillMatchIds = missedMatchIds.slice(1).reverse();

  logger.info(
    `[${player.alias}] 📦 ${discordMatchIds.length.toString()} match(es) for Discord, ${backfillMatchIds.length.toString()} for backfill`,
  );

  return { discordMatchIds, backfillMatchIds };
}
