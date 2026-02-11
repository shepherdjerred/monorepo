import type { RawMatch, PlayerConfigEntry, LeaguePuuid, MatchId, DiscordGuildId } from "@shepherdjerred/scout-data/index.ts";
import { getRecentMatchIds, filterNewMatches } from "@shepherdjerred/scout-backend/league/api/match-history.ts";
import {
  getAccountsWithState,
  updateLastProcessedMatch,
  getChannelsSubscribedToPlayers,
  getLastProcessedMatch,
  updateLastMatchTime,
  updateLastCheckedAt,
} from "@shepherdjerred/scout-backend/database/index.ts";
import { MatchIdSchema, DiscordGuildIdSchema } from "@shepherdjerred/scout-data/index.ts";
import { send, ChannelSendError } from "@shepherdjerred/scout-backend/league/discord/channel.ts";
import {
  shouldCheckPlayer,
  calculatePollingInterval,
  MAX_PLAYERS_PER_RUN,
} from "@shepherdjerred/scout-backend/utils/polling-intervals.ts";
import { generateMatchReport } from "@shepherdjerred/scout-backend/league/tasks/postmatch/match-report-generator.ts";
import { fetchMatchData } from "@shepherdjerred/scout-backend/league/tasks/postmatch/match-data-fetcher.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";
import { uniqueBy } from "remeda";
import { matchHistoryPollingSkipsTotal } from "@shepherdjerred/scout-backend/metrics/index.ts";

const logger = createLogger("postmatch-match-history-polling");

// Mutex to prevent concurrent match history polling runs
// This prevents race conditions where two cron runs process the same match
let isPollingInProgress = false;
let pollingStartTime: number | undefined;

// Timeout after 5 minutes to prevent indefinite lock if a run gets stuck
const POLLING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Check if polling is currently in progress.
 * Exposed for testing purposes.
 */
export function isMatchHistoryPollingInProgress(): boolean {
  return isPollingInProgress;
}

/**
 * Reset the polling in progress flag.
 * WARNING: Only use this in tests to reset state between test cases.
 */
export function resetPollingState(): void {
  isPollingInProgress = false;
  pollingStartTime = undefined;
}

/**
 * Check if we should skip this polling run due to concurrent execution.
 * Returns true if we should skip (another run is in progress and not timed out).
 * Handles timeout detection and lock reset when a run appears stuck.
 */
function shouldSkipPollingRun(): boolean {
  if (!isPollingInProgress) {
    return false;
  }

  const elapsed = pollingStartTime ? Date.now() - pollingStartTime : 0;

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

type PlayerWithMatchIds = {
  player: PlayerConfigEntry;
  matchIds: MatchId[];
};

/**
 * Process a single match for a player
 * Extracted to reduce nesting depth
 */
async function processMatchForPlayer(
  player: PlayerConfigEntry,
  matchId: MatchId,
  allPlayerConfigs: PlayerConfigEntry[],
  processedMatchIds: Set<MatchId>,
): Promise<void> {
  try {
    // Skip if we've already processed this match in this run
    if (processedMatchIds.has(matchId)) {
      logger.info(`[${player.alias}] ⏭️  Match ${matchId} already processed in this run`);
      return;
    }

    // Fetch match data
    const matchData = await fetchMatchData(matchId, player.league.leagueAccount.region);

    if (!matchData) {
      logger.info(`[${player.alias}] ⚠️  Could not fetch match data for ${matchId}, skipping`);
      return;
    }

    // Process the match with all tracked players
    await processMatchAndUpdatePlayers(matchData, allPlayerConfigs, processedMatchIds, matchId);
  } catch (error) {
    logger.error(`[${player.alias}] ❌ Error processing match ${matchId}:`, error);
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

/**
 * Process a completed match and send Discord notifications
 */
async function processMatch(matchData: RawMatch, trackedPlayers: PlayerConfigEntry[]): Promise<void> {
  const matchId = MatchIdSchema.parse(matchData.metadata.matchId);
  logger.info(`[processMatch] 🎮 Processing match ${matchId}`);

  try {
    // Determine which tracked players are in this match
    const playersInMatch = trackedPlayers.filter((player) =>
      matchData.metadata.participants.includes(player.league.leagueAccount.puuid),
    );

    // Get channels to notify FIRST - we need guild IDs for feature flag checks
    const puuids: LeaguePuuid[] = playersInMatch.map((p) => p.league.leagueAccount.puuid);
    const channels = await getChannelsSubscribedToPlayers(puuids);

    if (channels.length === 0) {
      logger.info(`[processMatch] ⚠️  No channels subscribed to players in match ${matchId}`);
      return;
    }

    // Extract unique guild IDs for feature flag checks
    const targetGuildIds: DiscordGuildId[] = uniqueBy(
      channels.map((c) => DiscordGuildIdSchema.parse(c.serverId)),
      (id) => id,
    );

    logger.info(`[processMatch] 🎯 Target guilds: ${targetGuildIds.join(", ")}`);

    // Generate the match report message with guild context for feature flags
    const message = await generateMatchReport(matchData, trackedPlayers, { targetGuildIds });

    if (!message) {
      logger.info(`[processMatch] ⚠️  No message generated for match ${matchId}`);
      return;
    }

    logger.info(`[processMatch] 📢 Sending notifications to ${channels.length.toString()} channel(s)`);

    // Send to all subscribed channels
    for (const { channel } of channels) {
      try {
        await send(message, channel);
        logger.info(`[processMatch] ✅ Sent notification to channel ${channel}`);
      } catch (error) {
        if (error instanceof ChannelSendError && error.isPermissionError) {
          logger.warn(`[processMatch] ⚠️  Permission error sending to channel ${channel}: ${error.message}`);
          continue;
        }

        logger.error(`[processMatch] ❌ Failed to send notification to channel ${channel}:`, error);
        Sentry.captureException(error, {
          tags: {
            source: "discord-notification",
            matchId,
            channel,
          },
        });
      }
    }

    logger.info(`[processMatch] ✅ Successfully processed match ${matchId}`);
  } catch (error) {
    logger.error(`[processMatch] ❌ Error processing match ${matchId}:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "process-match",
        matchId,
      },
    });
    throw error;
  }
}

/**
 * Process match and update all tracked players who participated
 */
async function processMatchAndUpdatePlayers(
  matchData: RawMatch,
  allPlayerConfigs: PlayerConfigEntry[],
  processedMatchIds: Set<string>,
  matchId: string,
): Promise<void> {
  // Get all tracked players in this match
  const allTrackedPlayers = allPlayerConfigs.filter((p) =>
    matchData.metadata.participants.includes(p.league.leagueAccount.puuid),
  );

  // Debug: Log which tracked players were found in this match
  logger.info(
    `[processMatch] 🔍 Match has ${matchData.metadata.participants.length.toString()} participants, ` +
      `we track ${allPlayerConfigs.length.toString()} accounts, ` +
      `found ${allTrackedPlayers.length.toString()} tracked players in match`,
  );
  if (allTrackedPlayers.length > 0) {
    logger.info(`[processMatch] 👥 Tracked players in match: ${allTrackedPlayers.map((p) => p.alias).join(", ")}`);
  }

  // Process the match
  await processMatch(matchData, allTrackedPlayers);

  // Mark as processed
  processedMatchIds.add(matchId);

  // Get match creation time for activity tracking
  const matchCreationTime = new Date(matchData.info.gameCreation);

  // Update lastProcessedMatchId and lastMatchTime for all players in this match
  logger.info(
    `[processMatch] ⏰ Updating lastMatchTime to ${matchCreationTime.toISOString()} for ${allTrackedPlayers.length.toString()} player(s)`,
  );
  for (const trackedPlayer of allTrackedPlayers) {
    const playerPuuid = trackedPlayer.league.leagueAccount.puuid;
    const brandedMatchId = MatchIdSchema.parse(matchId);
    await updateLastProcessedMatch(playerPuuid, brandedMatchId);
    await updateLastMatchTime(playerPuuid, matchCreationTime);
    logger.info(`[processMatch] ✅ Updated ${trackedPlayer.alias} lastMatchTime`);
  }
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
    logger.info(`📊 Found ${accountsWithState.length.toString()} total player account(s)`);

    if (accountsWithState.length === 0) {
      logger.info("⏸️  No players to check");
      return;
    }

    const currentTime = new Date();

    // Track distribution of players across polling intervals for monitoring
    const intervalDistribution = new Map<number, number>();
    for (const { lastMatchTime } of accountsWithState) {
      const interval = calculatePollingInterval(lastMatchTime, currentTime);
      intervalDistribution.set(interval, (intervalDistribution.get(interval) ?? 0) + 1);
    }

    // Log interval distribution
    for (const [interval, count] of intervalDistribution.entries()) {
      logger.info(`📊 Polling interval ${interval.toString()}min: ${count.toString()} account(s)`);
    }

    // Filter to only players that should be checked this cycle
    const eligiblePlayers = accountsWithState.filter(({ lastMatchTime, lastCheckedAt }) =>
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

    logger.info(`📊 Checking ${playersToCheck.length.toString()} account(s) this run`);

    if (playersToCheck.length === 0) {
      logger.info("⏸️  No players to check this cycle (based on polling intervals)");
      return;
    }

    // Fetch recent match IDs for each player
    const playersWithMatches: PlayerWithMatchIds[] = [];

    for (const { config: player, lastMatchTime, lastCheckedAt } of playersToCheck) {
      const puuid = player.league.leagueAccount.puuid;
      const interval = calculatePollingInterval(lastMatchTime, currentTime);

      logger.info(
        `[${player.alias}] 🔍 Checking match history (interval: ${interval.toString()}min, last match: ${lastMatchTime ? lastMatchTime.toISOString() : "never"}, last checked: ${lastCheckedAt ? lastCheckedAt.toISOString() : "never"})`,
      );

      try {
        // Query the last processed match ID from the database
        const lastProcessedMatchId = await getLastProcessedMatch(puuid);

        const recentMatchIds = await getRecentMatchIds(player, 5);

        // Update lastCheckedAt regardless of whether we found matches
        await updateLastCheckedAt(puuid, currentTime);

        if (!recentMatchIds || recentMatchIds.length === 0) {
          logger.info(`[${player.alias}] ℹ️  No recent matches found`);
          continue;
        }

        // Filter to only new matches
        const newMatchIds = filterNewMatches(recentMatchIds, lastProcessedMatchId);

        if (newMatchIds.length === 0) {
          logger.info(`[${player.alias}] ✅ No new matches to process`);
          continue;
        }

        logger.info(
          `[${player.alias}] 🆕 Found ${newMatchIds.length.toString()} new match(es): ${newMatchIds.join(", ")}`,
        );
        playersWithMatches.push({ player, matchIds: newMatchIds });
      } catch (error) {
        logger.error(`[${player.alias}] ❌ Error checking match history:`, error);
        Sentry.captureException(error, {
          tags: {
            source: "match-history-check",
            playerAlias: player.alias,
            puuid,
          },
        });
        // Continue with next player even if this one fails
      }
    }

    if (playersWithMatches.length === 0) {
      logger.info("✅ No new matches found for any players");
      const totalTime = Date.now() - startTime;
      logger.info(`⏱️  Match history check completed in ${totalTime.toString()}ms`);
      return;
    }

    logger.info(
      `🎮 Processing ${playersWithMatches.reduce((sum, p) => sum + p.matchIds.length, 0).toString()} new match(es) from ${playersWithMatches.length.toString()} player(s)`,
    );

    // Get all player configs for match processing (we need all configs, not just the ones we checked)
    const allPlayerConfigs = accountsWithState.map((a) => a.config);

    // Process each match
    // We need to deduplicate matches since multiple tracked players might be in the same game
    const processedMatchIds = new Set<MatchId>();

    for (const { player, matchIds } of playersWithMatches) {
      for (const matchId of matchIds) {
        await processMatchForPlayer(player, matchId, allPlayerConfigs, processedMatchIds);
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`✅ Match history check completed in ${totalTime.toString()}ms`);
    logger.info(`📊 Processed ${processedMatchIds.size.toString()} unique match(es)`);
  } catch (error) {
    logger.error("❌ Error in match history check:", error);
    throw error;
  } finally {
    isPollingInProgress = false;
    pollingStartTime = undefined;
  }
}
