import type { PlayerConfigEntry } from "@scout-for-lol/data/index.ts";
import { getAccountsWithState } from "#src/database/index.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";
import {
  getActiveGames,
  upsertActiveGame,
  deleteExpiredActiveGames,
  getActiveGameCount,
} from "#src/league/tasks/prematch/active-game-queries.ts";
import { sendPrematchNotification } from "#src/league/tasks/prematch/prematch-notification.ts";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import { createLogger } from "#src/logger.ts";
import {
  prematchDetectionsTotal,
  prematchActiveGamesGauge,
  prematchPollingSkipsTotal,
} from "#src/metrics/index.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("prematch-active-game-detection");

let isCheckInProgress = false;
let checkStartTime: number | undefined;
const CHECK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

function shouldSkipCheck(): boolean {
  if (!isCheckInProgress) {
    return false;
  }

  const elapsed =
    checkStartTime === undefined ? 0 : Date.now() - checkStartTime;

  if (elapsed > CHECK_TIMEOUT_MS) {
    logger.error(
      `⚠️  Pre-match check lock timeout after ${Math.round(elapsed / 1000).toString()}s, force-resetting`,
    );
    prematchPollingSkipsTotal.inc({ reason: "timeout_reset" });
    Sentry.captureMessage("Pre-match check lock timeout - force reset", {
      level: "warning",
      tags: { source: "prematch-detection" },
      extra: { elapsedMs: elapsed },
    });
    isCheckInProgress = false;
    checkStartTime = undefined;
    return false;
  }

  logger.info(
    `⏸️  Pre-match check already in progress (${Math.round(elapsed / 1000).toString()}s elapsed), skipping`,
  );
  prematchPollingSkipsTotal.inc({ reason: "concurrent_run" });
  return true;
}

/**
 * Main function to check for active games across all tracked players.
 *
 * Detects when tracked players enter a game and sends a single notification
 * per game, listing all tracked players in that game.
 */
export async function checkActiveGames(): Promise<void> {
  if (shouldSkipCheck()) {
    return;
  }

  isCheckInProgress = true;
  const startTime = Date.now();
  checkStartTime = startTime;
  logger.info("🔍 Starting pre-match active game check");

  try {
    const accountsWithState = await getAccountsWithState();
    logger.info(
      `📊 Found ${accountsWithState.length.toString()} total player account(s)`,
    );

    if (accountsWithState.length === 0) {
      logger.info("⏸️  No players to check");
      return;
    }

    // Load currently tracked active games from DB
    const activeGames = await getActiveGames();
    const trackedPuuids = new Set(
      activeGames.flatMap((game) => game.trackedPuuids),
    );
    const trackedGameIds = new Set(activeGames.map((game) => game.gameId));

    logger.info(
      `📊 ${activeGames.length.toString()} active game(s) currently tracked, ${trackedPuuids.size.toString()} player(s) in games`,
    );

    // Build lookup of all tracked puuids for cross-referencing with game participants
    const allTrackedPuuids = new Set(
      accountsWithState.map((a) => a.config.league.leagueAccount.puuid),
    );
    const allPlayerConfigs = accountsWithState.map((a) => a.config);

    // Filter to players not already in a tracked game, limit to MAX_PLAYERS_PER_RUN
    const playersToCheck = accountsWithState
      .filter((a) => !trackedPuuids.has(a.config.league.leagueAccount.puuid))
      .slice(0, MAX_PLAYERS_PER_RUN);

    logger.info(
      `📊 Checking ${playersToCheck.length.toString()} player(s) this run (${(accountsWithState.length - playersToCheck.length).toString()} skipped)`,
    );

    let gamesDetected = 0;

    for (const { config: player } of playersToCheck) {
      const puuid = player.league.leagueAccount.puuid;
      const region = player.league.leagueAccount.region;

      try {
        const gameInfo = await getActiveGame(puuid, region);

        if (!gameInfo) {
          continue;
        }

        // Check if this game is already tracked
        if (trackedGameIds.has(gameInfo.gameId)) {
          prematchDetectionsTotal.inc({ status: "already_tracked" });
          continue;
        }

        // Find ALL tracked players in this game's participants
        const trackedPlayersInGame: PlayerConfigEntry[] =
          allPlayerConfigs.filter((p) =>
            gameInfo.participants.some(
              (participant) =>
                participant.puuid === p.league.leagueAccount.puuid &&
                allTrackedPuuids.has(p.league.leagueAccount.puuid),
            ),
          );

        const trackedPuuidsInGame = trackedPlayersInGame.map(
          (p) => p.league.leagueAccount.puuid,
        );

        logger.info(
          `🎮 New game detected: ${gameInfo.gameId.toString()} with ${trackedPlayersInGame.length.toString()} tracked player(s): ${trackedPlayersInGame.map((p) => p.alias).join(", ")}`,
        );

        // Persist to DB
        await upsertActiveGame(gameInfo.gameId, trackedPuuidsInGame);

        // Mark this game as tracked for the rest of this run
        trackedGameIds.add(gameInfo.gameId);
        for (const p of trackedPuuidsInGame) {
          trackedPuuids.add(p);
        }

        // Send notification
        await sendPrematchNotification(gameInfo, trackedPlayersInGame);

        prematchDetectionsTotal.inc({ status: "detected" });
        gamesDetected++;
      } catch (error) {
        logger.error(
          `[${player.alias}] ❌ Error checking active game:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "prematch-detection",
            playerAlias: player.alias,
            puuid,
          },
        });
      }
    }

    // Cleanup expired entries
    await deleteExpiredActiveGames();

    // Update gauge
    const currentCount = await getActiveGameCount();
    prematchActiveGamesGauge.set(currentCount);

    const totalTime = Date.now() - startTime;
    logger.info(
      `✅ Pre-match check completed in ${totalTime.toString()}ms — ${gamesDetected.toString()} new game(s) detected, ${currentCount.toString()} active game(s) tracked`,
    );
  } catch (error) {
    logger.error("❌ Error in pre-match active game check:", error);
    throw error;
  } finally {
    isCheckInProgress = false;
    checkStartTime = undefined;
  }
}
