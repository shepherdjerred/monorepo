import type {
  RawMatch,
  PlayerConfigEntry,
  LeaguePuuid,
  MatchId,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import {
  getRecentMatchIds,
  filterNewMatches,
} from "#src/league/api/match-history.ts";
import {
  getAccountsWithState,
  updateLastProcessedMatch,
  getChannelsSubscribedToPlayers,
  getLastProcessedMatch,
  updateLastMatchTime,
  updateLastCheckedAt,
} from "#src/database/index.ts";
import {
  MatchIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { send, ChannelSendError } from "#src/league/discord/channel.ts";
import {
  shouldCheckPlayer,
  calculatePollingInterval,
} from "#src/utils/polling-intervals.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import {
  processMatchForPlayer,
  type PlayerWithMatchIds,
  type ProcessMatchUpdateOptions,
} from "#src/league/tasks/postmatch/match-processing.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { uniqueBy } from "remeda";
import { matchHistoryPollingSkipsTotal } from "#src/metrics/index.ts";
import {
  setLastSuccessfulPollAt,
  getLastSuccessfulPollAt,
} from "#src/league/tasks/recovery/app-state.ts";
import { fetchMatchIdsForTimeRange } from "#src/league/tasks/recovery/backfill-to-s3.ts";
import { saveMatchToS3 } from "#src/storage/s3.ts";

const logger = createLogger("postmatch-match-history-polling");

let isPollingInProgress = false;
let pollingStartTime: number | undefined;
const POLLING_TIMEOUT_MS = 5 * 60 * 1000;

export function isMatchHistoryPollingInProgress(): boolean {
  return isPollingInProgress;
}

export function resetPollingState(): void {
  isPollingInProgress = false;
  pollingStartTime = undefined;
}
function shouldSkipPollingRun(): boolean {
  if (!isPollingInProgress) {
    return false;
  }

  const elapsed =
    pollingStartTime === undefined ? 0 : Date.now() - pollingStartTime;

  // Check if the lock is stale (stuck for over 5 minutes)
  if (elapsed > POLLING_TIMEOUT_MS) {
    logger.error(
      `⚠️  Polling lock timeout detected after ${Math.round(elapsed / 1000).toString()}s, force-resetting stale lock`,
    );
    matchHistoryPollingSkipsTotal.inc({ reason: "timeout_reset" });
    Sentry.captureMessage("Match history polling lock timeout - force reset", {
      level: "warning",
      tags: { source: "match-history-polling" },
      extra: { elapsedMs: elapsed },
    });
    isPollingInProgress = false;
    pollingStartTime = undefined;
    return false;
  }

  logger.info(
    `⏸️  Match history polling already in progress (${Math.round(elapsed / 1000).toString()}s elapsed), skipping this run`,
  );
  matchHistoryPollingSkipsTotal.inc({ reason: "concurrent_run" });
  return true;
}

/**
 * Process a completed match and send Discord notifications
 */
async function processMatch(
  matchData: RawMatch,
  trackedPlayers: PlayerConfigEntry[],
): Promise<void> {
  const matchId = MatchIdSchema.parse(matchData.metadata.matchId);
  logger.info(`[processMatch] 🎮 Processing match ${matchId}`);

  const playersInMatch = trackedPlayers.filter((player) =>
    matchData.metadata.participants.includes(player.league.leagueAccount.puuid),
  );

  const puuids: LeaguePuuid[] = playersInMatch.map(
    (p) => p.league.leagueAccount.puuid,
  );
  const channels = await getChannelsSubscribedToPlayers(puuids);

  if (channels.length === 0) {
    logger.info(
      `[processMatch] ⚠️  No channels subscribed for match ${matchId}`,
    );
    return;
  }

  const targetGuildIds: DiscordGuildId[] = uniqueBy(
    channels.map((c) => DiscordGuildIdSchema.parse(c.serverId)),
    (id) => id,
  );

  const message = await generateMatchReport(matchData, trackedPlayers, {
    targetGuildIds,
  });

  if (!message) {
    logger.info(`[processMatch] ⚠️  No message generated for match ${matchId}`);
    return;
  }

  for (const { channel } of channels) {
    try {
      await send(message, channel);
    } catch (error) {
      if (error instanceof ChannelSendError && error.permissionError) {
        logger.warn(
          `[processMatch] ⚠️  Permission error for channel ${channel}: ${error.message}`,
        );
        continue;
      }
      logger.error(
        `[processMatch] ❌ Failed to send to channel ${channel}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "discord-notification", matchId, channel },
      });
    }
  }

  logger.info(`[processMatch] ✅ Processed match ${matchId}`);
}

/**
 * Process match and update all tracked players who participated
 */
async function processMatchAndUpdatePlayers(
  options: ProcessMatchUpdateOptions,
): Promise<void> {
  const {
    matchData,
    allPlayerConfigs,
    processedMatchIds,
    matchId,
    silent = false,
  } = options;

  // Get all tracked players in this match
  const allTrackedPlayers = allPlayerConfigs.filter((p) =>
    matchData.metadata.participants.includes(p.league.leagueAccount.puuid),
  );

  logger.info(
    `[processMatch] 🔍 ${allTrackedPlayers.length.toString()} tracked player(s) in match: ${allTrackedPlayers.map((p) => p.alias).join(", ")}`,
  );

  if (silent) {
    try {
      const aliases = allTrackedPlayers.map((p) => p.alias);
      await saveMatchToS3(matchData, aliases);
      logger.info(`[backfill] 📦 Saved match ${matchId} to S3`);
    } catch (error) {
      logger.error(`[backfill] Error saving match ${matchId} to S3:`, error);
    }
  } else {
    await processMatch(matchData, allTrackedPlayers);
  }

  // Mark as processed
  processedMatchIds.add(matchId);

  // Update lastProcessedMatchId and lastMatchTime for all players in this match
  const matchCreationTime = new Date(matchData.info.gameCreation);
  for (const trackedPlayer of allTrackedPlayers) {
    const playerPuuid = trackedPlayer.league.leagueAccount.puuid;
    const brandedMatchId = MatchIdSchema.parse(matchId);
    await updateLastProcessedMatch(playerPuuid, brandedMatchId);
    await updateLastMatchTime(playerPuuid, matchCreationTime);
  }
}

type AccountWithState = {
  config: PlayerConfigEntry;
  lastMatchTime: Date | undefined;
  lastCheckedAt: Date | undefined;
};

/**
 * Collect new matches for each player, handling gap detection and backfill recovery.
 */
async function collectNewMatches(
  playersToCheck: AccountWithState[],
  currentTime: Date,
): Promise<PlayerWithMatchIds[]> {
  const playersWithMatches: PlayerWithMatchIds[] = [];

  for (const {
    config: player,
    lastMatchTime,
    lastCheckedAt,
  } of playersToCheck) {
    const puuid = player.league.leagueAccount.puuid;
    const interval = calculatePollingInterval(lastMatchTime, currentTime);

    logger.info(
      `[${player.alias}] 🔍 Checking match history (interval: ${interval.toString()}min, last match: ${lastMatchTime ? lastMatchTime.toISOString() : "never"}, last checked: ${lastCheckedAt ? lastCheckedAt.toISOString() : "never"})`,
    );

    try {
      const lastProcessedMatchId = await getLastProcessedMatch(puuid);
      const recentMatchIds = await getRecentMatchIds(player, 5);
      await updateLastCheckedAt(puuid, currentTime);

      if (!recentMatchIds || recentMatchIds.length === 0) {
        logger.info(`[${player.alias}] ℹ️  No recent matches found`);
        continue;
      }

      const { matchIds: newMatchIds, gapDetected } = filterNewMatches(
        recentMatchIds,
        lastProcessedMatchId,
      );

      if (newMatchIds.length === 0) {
        logger.info(`[${player.alias}] ✅ No new matches to process`);
        continue;
      }

      let discordMatchIds: MatchId[];
      let backfillMatchIds: MatchId[] = [];

      if (gapDetected) {
        const recovered = await recoverMissedMatches(player, newMatchIds);
        discordMatchIds = recovered.discordMatchIds;
        backfillMatchIds = recovered.backfillMatchIds;
      } else {
        discordMatchIds = newMatchIds;
      }

      logger.info(
        `[${player.alias}] 🆕 Found ${discordMatchIds.length.toString()} new match(es) for Discord: ${discordMatchIds.join(", ")}`,
      );
      playersWithMatches.push({
        player,
        matchIds: discordMatchIds,
        backfillMatchIds,
      });
    } catch (error) {
      logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
      Sentry.captureException(error, {
        tags: {
          source: "match-history-check",
          playerAlias: player.alias,
          puuid,
        },
      });
    }
  }

  return playersWithMatches;
}

type GapRecoveryResult = {
  discordMatchIds: MatchId[];
  backfillMatchIds: MatchId[];
};

/**
 * When a gap is detected (lastProcessedMatchId not in recent history),
 * fetch all missed matches via paginated time-range API and split into
 * Discord (most recent) and backfill (rest, oldest first) buckets.
 */
async function recoverMissedMatches(
  player: PlayerConfigEntry,
  fallbackMatchIds: MatchId[],
): Promise<GapRecoveryResult> {
  const puuid = player.league.leagueAccount.puuid;
  const lastPollAt = await getLastSuccessfulPollAt();

  if (!lastPollAt) {
    // No lastPollAt — first startup, just process the most recent
    return {
      discordMatchIds: fallbackMatchIds.slice(0, 1),
      backfillMatchIds: [],
    };
  }

  const startEpoch = Math.floor(lastPollAt.getTime() / 1000);
  const endEpoch = Math.floor(Date.now() / 1000);

  logger.info(
    `[${player.alias}] 🔄 Gap detected, fetching all missed matches since ${lastPollAt.toISOString()}`,
  );

  const allMissedMatchIds = await fetchMatchIdsForTimeRange(
    puuid,
    player.league.leagueAccount.region,
    startEpoch,
    endEpoch,
  );

  const mostRecent = allMissedMatchIds[0];
  if (!mostRecent) {
    return {
      discordMatchIds: fallbackMatchIds.slice(0, 1),
      backfillMatchIds: [],
    };
  }

  // Most recent match (index 0) gets Discord notification
  const discordMatchIds = [mostRecent];
  // Rest are backfill-only (reversed to process oldest first)
  const backfillMatchIds = allMissedMatchIds.slice(1).reverse();

  logger.info(
    `[${player.alias}] 📦 ${discordMatchIds.length.toString()} match(es) for Discord, ${backfillMatchIds.length.toString()} for backfill`,
  );

  return { discordMatchIds, backfillMatchIds };
}

/**
 * Main function to check for new matches via match history polling
 */
export async function checkMatchHistory(): Promise<void> {
  // Prevent concurrent runs to avoid race conditions where two cron runs
  // could process the same match before lastProcessedMatchId is updated
  if (shouldSkipPollingRun()) {
    return;
  }

  isPollingInProgress = true;
  pollingStartTime = Date.now();
  logger.info("🔍 Starting match history polling check");
  const startTime = Date.now();

  try {
    // Get all tracked player accounts with their polling state
    const accountsWithState = await getAccountsWithState();
    logger.info(
      `📊 Found ${accountsWithState.length.toString()} total player account(s)`,
    );

    if (accountsWithState.length === 0) {
      logger.info("⏸️  No players to check");
      await setLastSuccessfulPollAt(new Date());
      return;
    }

    const currentTime = new Date();

    const eligiblePlayers = accountsWithState.filter(
      ({ lastMatchTime, lastCheckedAt }) =>
        shouldCheckPlayer(lastMatchTime, lastCheckedAt, currentTime),
    );

    logger.info(
      `📊 ${eligiblePlayers.length.toString()} / ${accountsWithState.length.toString()} account(s) eligible this cycle`,
    );

    // Sort by lastCheckedAt (oldest first) to prioritize players who haven't been checked recently
    // Players never checked (undefined) come first
    const sortedEligiblePlayers = eligiblePlayers.toSorted((a, b) => {
      if (a.lastCheckedAt === undefined && b.lastCheckedAt === undefined) {
        return 0;
      }
      if (a.lastCheckedAt === undefined) {
        return -1;
      }
      if (b.lastCheckedAt === undefined) {
        return 1;
      }
      return a.lastCheckedAt.getTime() - b.lastCheckedAt.getTime();
    });

    // Limit to MAX_PLAYERS_PER_RUN to prevent API rate limiting
    const playersToCheck = sortedEligiblePlayers.slice(0, MAX_PLAYERS_PER_RUN);

    if (eligiblePlayers.length > MAX_PLAYERS_PER_RUN) {
      logger.info(
        `⚠️  Limiting to ${MAX_PLAYERS_PER_RUN.toString()} players (${(eligiblePlayers.length - MAX_PLAYERS_PER_RUN).toString()} deferred to next run)`,
      );
    }

    logger.info(
      `📊 Checking ${playersToCheck.length.toString()} account(s) this run`,
    );

    if (playersToCheck.length === 0) {
      logger.info(
        "⏸️  No players to check this cycle (based on polling intervals)",
      );
      await setLastSuccessfulPollAt(new Date());
      return;
    }

    const playersWithMatches = await collectNewMatches(
      playersToCheck,
      currentTime,
    );

    if (playersWithMatches.length === 0) {
      logger.info("✅ No new matches found for any players");
      const totalTime = Date.now() - startTime;
      logger.info(
        `⏱️  Match history check completed in ${totalTime.toString()}ms`,
      );
      await setLastSuccessfulPollAt(new Date());
      return;
    }

    const totalDiscord = playersWithMatches.reduce(
      (sum, p) => sum + p.matchIds.length,
      0,
    );
    const totalBackfill = playersWithMatches.reduce(
      (sum, p) => sum + p.backfillMatchIds.length,
      0,
    );
    logger.info(
      `🎮 Processing ${totalDiscord.toString()} Discord match(es) + ${totalBackfill.toString()} backfill match(es) from ${playersWithMatches.length.toString()} player(s)`,
    );

    // Get all player configs for match processing (we need all configs, not just the ones we checked)
    const allPlayerConfigs = accountsWithState.map((a) => a.config);

    // Process each match
    // We need to deduplicate matches since multiple tracked players might be in the same game
    const processedMatchIds = new Set<MatchId>();

    // Phase 1: Backfill matches (S3 only, oldest first)
    for (const { player, backfillMatchIds } of playersWithMatches) {
      for (const matchId of backfillMatchIds) {
        await processMatchForPlayer({
          player,
          matchId,
          allPlayerConfigs,
          processedMatchIds,
          processMatchAndUpdatePlayers,
          silent: true,
        });
      }
    }

    // Phase 2: Discord matches (full processing)
    for (const { player, matchIds } of playersWithMatches) {
      for (const matchId of matchIds) {
        await processMatchForPlayer({
          player,
          matchId,
          allPlayerConfigs,
          processedMatchIds,
          processMatchAndUpdatePlayers,
          silent: false,
        });
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(
      `✅ Match history check completed in ${totalTime.toString()}ms`,
    );
    logger.info(
      `📊 Processed ${processedMatchIds.size.toString()} unique match(es)`,
    );

    await setLastSuccessfulPollAt(new Date());
  } catch (error) {
    logger.error("❌ Error in match history check:", error);
    throw error;
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}
