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
import { shouldCheckPlayer } from "#src/utils/polling-intervals.ts";
import { CircuitBreaker } from "#src/utils/circuit-breaker.ts";
import { createLogger } from "#src/logger.ts";
import {
  prematchDetectionsTotal,
  prematchActiveGamesGauge,
  prematchPollingSkipsTotal,
  prematchSubsequentMatchDetectedTotal,
} from "#src/metrics/index.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("prematch-active-game-detection");

/**
 * Circuit breaker for the Riot spectator API. When the API returns repeated
 * 502/503 errors the circuit opens and remaining players in the current
 * polling cycle are skipped, reducing wasted requests and Bugsink noise.
 */
const spectatorCircuit = new CircuitBreaker("spectator-api");

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

    // Load currently tracked active games from DB. We use these for two
    // things only: (1) gameId-based dedup so two players in the same game
    // produce one notification, and (2) detecting "subsequent match" cases
    // where a player who already had an ActiveGame row enters a new game
    // (different gameId) — that's the metric/log path that proves we
    // correctly stopped skipping in-game players.
    //
    // We deliberately do NOT filter players out by PUUID just because they
    // have a non-expired ActiveGame row. Doing so used to skip them for the
    // row's full 2-hour TTL even after their game ended, missing every
    // subsequent match in that window — the root cause of the "only first
    // game of the day announces" bug.
    //
    // Future optimization: once the post-match task actively deletes the
    // ActiveGame row when the corresponding match completes (instead of
    // waiting for the TTL), we can re-introduce a PUUID skip-list as a
    // pure Spectator API call saver — it would then accurately mean "this
    // player is mid-match, don't waste an API call".
    const activeGames = await getActiveGames();
    const trackedGameIds = new Set(activeGames.map((game) => game.gameId));
    const priorGameIdByPuuid = new Map<string, number>();
    for (const game of activeGames) {
      for (const puuid of game.trackedPuuids) {
        priorGameIdByPuuid.set(puuid, game.gameId);
      }
    }

    logger.info(
      `📊 ${activeGames.length.toString()} active game(s) currently tracked across ${priorGameIdByPuuid.size.toString()} player(s)`,
    );

    // Build lookup of all tracked puuids for cross-referencing with game participants
    const allTrackedPuuids = new Set(
      accountsWithState.map((a) => a.config.league.leagueAccount.puuid),
    );
    const allPlayerConfigs = accountsWithState.map((a) => a.config);

    const currentTime = new Date();

    const eligible = accountsWithState.filter(
      ({ lastMatchTime, lastCheckedAt }) =>
        shouldCheckPlayer(lastMatchTime, lastCheckedAt, currentTime),
    );

    logger.info(
      `📊 ${eligible.length.toString()} / ${accountsWithState.length.toString()} account(s) eligible this cycle`,
    );

    // Sort by lastCheckedAt ascending (oldest first), then limit
    const sorted = eligible.toSorted((a, b) => {
      if (a.lastCheckedAt === undefined && b.lastCheckedAt === undefined)
        return 0;
      if (a.lastCheckedAt === undefined) return -1;
      if (b.lastCheckedAt === undefined) return 1;
      return a.lastCheckedAt.getTime() - b.lastCheckedAt.getTime();
    });
    const playersToCheck = sorted.slice(0, MAX_PLAYERS_PER_RUN);

    if (eligible.length > MAX_PLAYERS_PER_RUN) {
      logger.info(
        `⚠️  Limiting to ${MAX_PLAYERS_PER_RUN.toString()} players (${(eligible.length - MAX_PLAYERS_PER_RUN).toString()} deferred to next run)`,
      );
    }

    logger.info(
      `📊 Checking ${playersToCheck.length.toString()} player(s) this run (${(accountsWithState.length - playersToCheck.length).toString()} skipped)`,
    );

    let gamesDetected = 0;

    let playersSkippedByCircuit = 0;

    for (const { config: player } of playersToCheck) {
      const puuid = player.league.leagueAccount.puuid;
      const region = player.league.leagueAccount.region;

      // Circuit breaker: skip remaining players when the spectator API is down
      if (spectatorCircuit.shouldSkip()) {
        playersSkippedByCircuit++;
        prematchPollingSkipsTotal.inc({ reason: "circuit_open" });
        continue;
      }

      try {
        const { game: gameInfo, upstreamError } = await getActiveGame(
          puuid,
          region,
        );

        if (upstreamError) {
          // Feed the failure into the circuit breaker (rate-limited Sentry reporting)
          spectatorCircuit.recordFailure(
            new Error(`Spectator API upstream error for ${puuid}`),
            { source: "spectator", puuid, region },
          );
          continue;
        }

        // Any non-upstream response (success, 404, validation error) means the API is reachable
        spectatorCircuit.recordSuccess();

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

        // Detect "subsequent match" — a tracked player whose PUUID was
        // already in a (different) ActiveGame row before this run. This is
        // the case the bug fix enables: previously these players were
        // filtered out of polling entirely. Counting it gives us direct
        // production evidence the fix is live.
        const subsequentForPuuids = trackedPuuidsInGame.filter((p) => {
          const prior = priorGameIdByPuuid.get(p);
          return prior !== undefined && prior !== gameInfo.gameId;
        });

        logger.info(
          `🎮 New game detected: ${gameInfo.gameId.toString()} with ${trackedPlayersInGame.length.toString()} tracked player(s): ${trackedPlayersInGame.map((p) => p.alias).join(", ")}`,
        );

        if (subsequentForPuuids.length > 0) {
          const priorGameIds = subsequentForPuuids.map((p) =>
            (priorGameIdByPuuid.get(p) ?? 0).toString(),
          );
          const subsequentAliases = trackedPlayersInGame
            .filter((p) =>
              subsequentForPuuids.includes(p.league.leagueAccount.puuid),
            )
            .map((p) => p.alias);
          logger.info(
            `🔁 Subsequent game detected for player(s) [${subsequentAliases.join(", ")}] — prior gameId(s) [${priorGameIds.join(", ")}], new gameId ${gameInfo.gameId.toString()}`,
          );
          prematchSubsequentMatchDetectedTotal.inc(subsequentForPuuids.length);
        }

        // Persist to DB (gameId is unique; upsert is safe under concurrent
        // detection of the same game from different polled players)
        await upsertActiveGame(gameInfo.gameId, trackedPuuidsInGame);

        // Mark this game as tracked for the rest of this run so subsequent
        // players in the same lobby don't re-detect it
        trackedGameIds.add(gameInfo.gameId);
        for (const p of trackedPuuidsInGame) {
          priorGameIdByPuuid.set(p, gameInfo.gameId);
        }

        // Send notification
        await sendPrematchNotification(gameInfo, trackedPlayersInGame);

        prematchDetectionsTotal.inc({ status: "detected" });
        gamesDetected++;
      } catch (error) {
        logger.error(`[${player.alias}] ❌ Error checking active game:`, error);
        Sentry.captureException(error, {
          tags: {
            source: "prematch-detection",
            playerAlias: player.alias,
            puuid,
          },
        });
      }
    }

    if (playersSkippedByCircuit > 0) {
      logger.warn(
        `⚡ Circuit breaker skipped ${playersSkippedByCircuit.toString()} player(s) due to spectator API outage`,
      );
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
