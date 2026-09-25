import type {
  LeaguePuuid,
  MatchId,
  PlayerConfigEntry,
  RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import { LeaguePuuidSchema, MatchIdSchema } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import {
  getAccountConfigsByPuuids,
  getAccountsWithState,
} from "#src/database/player-accounts.ts";
import {
  isLikelyPreStartLobby,
  rosterIsAsCompleteAsItWillGet,
} from "#src/league/tasks/prematch/spectator-roster.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";
import {
  getActiveGames,
  upsertActiveGame,
  deleteActiveGame,
  deleteExpiredActiveGames,
  getActiveGameCount,
  recordPrematchMessageIds,
} from "#src/league/tasks/prematch/active-game-queries.ts";
import { sendPrematchNotification } from "#src/league/tasks/prematch/prematch-notification.ts";
import { PrematchNotificationPostDeliveryError } from "#src/league/tasks/prematch/prematch-notification-errors.ts";
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
import { recordPrematchForReportStore } from "#src/report-store/live-ingest.ts";
import { recordClashPrematchSightings } from "#src/league/clash/sighting.ts";

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

/**
 * Retry budget for a roster that is still filling.
 *
 * Riot surfaces a game during its pre-game countdown, so the first read often
 * arrives short. A couple of in-process retries usually catch the full roster;
 * anything still short is left for the next 30-second tick, which is cheaper
 * than holding this one open. See `spectator-roster.ts` for what "short"
 * means and why a started game is a different case.
 */
const LOBBY_RETRY_LIMIT = 2;
const LOBBY_RETRY_DELAY_MS = 2000;

async function refetchLobbyUntilFilled(
  initial: RawCurrentGameInfo,
  puuid: LeaguePuuid,
  region: PlayerConfigEntry["league"]["leagueAccount"]["region"],
  retryDelayMs: number = LOBBY_RETRY_DELAY_MS,
): Promise<RawCurrentGameInfo> {
  let latest = initial;
  for (let attempt = 1; attempt <= LOBBY_RETRY_LIMIT; attempt++) {
    if (!isLikelyPreStartLobby(latest)) {
      return latest;
    }
    logger.info(
      `[prestart-lobby] gameId=${latest.gameId.toString()} only ${latest.participants.length.toString()}/10 participants — retry ${attempt.toString()}/${LOBBY_RETRY_LIMIT.toString()} in ${retryDelayMs.toString()}ms`,
    );
    await Bun.sleep(retryDelayMs);
    const retry = await getActiveGame(puuid, region);
    // Any answer that is not a fresh payload ends the retry loop with the most
    // recent one, and the caller's outer logic decides — v1's behaviour before
    // the spectator boundary distinguished its three outcomes, kept exactly.
    // It is safe HERE in a way it would not be in the V2 capture: this runs on
    // a 30-second cron with no durable conclusion, so a missed retry costs one
    // tick rather than the whole snapshot.
    if (retry.kind === "unavailable") {
      // Only a genuine upstream outage feeds the breaker, so repeated failures
      // during the retry window trip it for later players in the same tick.
      if (retry.upstream) {
        spectatorCircuit.recordFailure(
          new Error(
            `Spectator API upstream error during pre-start lobby retry for ${puuid}`,
          ),
          { source: "spectator-retry", puuid, region },
        );
      }
      return latest;
    }
    // Player left the lobby between retries.
    if (retry.kind === "not-in-game") {
      return latest;
    }
    latest = retry.game;
  }
  return latest;
}

/**
 * One player's spectator read, reduced to the only thing this poller acts on:
 * a game to process, or nothing.
 *
 * The three outcomes the boundary now distinguishes collapse back to two HERE,
 * deliberately, because that is v1's behaviour and it is safe in v1. This runs
 * on a 30-second cron and records nothing durable about a skip, so an
 * unanswered read costs one tick. The V2 capture cannot make the same trade —
 * its conclusion is sealed by a completed Workflow ID — which is why the
 * distinction lives at the boundary rather than being flattened inside it.
 *
 * Extracted from the polling loop so the collapse is stated once, somewhere it
 * can explain itself, rather than adding a branch to a function already at its
 * complexity budget.
 */
async function pollPlayerForGame(
  puuid: LeaguePuuid,
  region: PlayerConfigEntry["league"]["leagueAccount"]["region"],
): Promise<RawCurrentGameInfo | undefined> {
  const spectator = await getActiveGame(puuid, region);
  if (spectator.kind === "unavailable") {
    if (spectator.upstream) {
      // Feed the failure into the circuit breaker (rate-limited Sentry reporting)
      spectatorCircuit.recordFailure(
        new Error(`Spectator API upstream error for ${puuid}`),
        { source: "spectator", puuid, region },
      );
      return undefined;
    }
    // A validation failure or a one-off HTTP error still proves the API is
    // reachable, so it closes the breaker exactly as it did before.
    spectatorCircuit.recordSuccess();
    return undefined;
  }
  // A 404 is an answer, so the API is reachable.
  spectatorCircuit.recordSuccess();
  return spectator.kind === "in-game" ? spectator.game : undefined;
}

/**
 * Log and count a roster this tick will not act on.
 *
 * The two reasons look the same from here and are not the same fact. One is a
 * lobby still loading in; the other is a game already under way whose roster is
 * simply short, which is what a custom against bots looks like because Riot
 * never lists them. Counting them apart is what makes the second visible.
 */
function recordDeferredRoster(
  alias: string,
  gameInfo: RawCurrentGameInfo,
): void {
  const settled = rosterIsAsCompleteAsItWillGet(gameInfo);
  const participants = gameInfo.participants.length.toString();
  const gameId = gameInfo.gameId.toString();
  const gameLength = gameInfo.gameLength.toString();
  logger.info(
    settled
      ? `[${alias}] ⏳ Deferring gameId=${gameId} — ${participants}/10 participants and the game has already started (gameLength=${gameLength}), so this is the roster Riot will report; bots are never listed`
      : `[${alias}] ⏳ Deferring pre-start gameId=${gameId} — only ${participants}/10 participants present (gameLength=${gameLength}); next cron tick will retry`,
  );
  // The original label is kept for Grafana dashboard continuity; the new one
  // separates "still filling" from "this is the roster".
  prematchDetectionsTotal.inc({
    status: settled ? "deferred_undersized_roster" : "deferred_custom_prestart",
  });
}

async function processPrematchWithRetryCleanup(input: {
  matchId: MatchId;
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: PlayerConfigEntry[];
}): Promise<Map<string, string>> {
  try {
    await recordPrematchForReportStore({
      gameInfo: input.gameInfo,
      observedAt: new Date(),
      source: "prematch_live",
      trackedPlayerAliases: input.trackedPlayers.map((p) => p.alias),
    });
    await recordClashPrematchSightings(
      input.gameInfo,
      new Set(
        input.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
      ),
    );
    return await sendPrematchNotification(input.gameInfo, input.trackedPlayers);
  } catch (error) {
    if (!(error instanceof PrematchNotificationPostDeliveryError)) {
      await deleteActiveGame(MatchIdSchema.parse(input.matchId));
    }
    throw error;
  }
}

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
 * Whether the V2 prematch path already took one game, asked before v1
 * announces a game it has not tracked. V2 writes no `ActiveGame` row, so
 * without this a flip from V2 back to v1 mid-game would announce the game a
 * second time and open its markets after the fact.
 */
export type PrematchV2CaptureCheck = (game: {
  platformId: string;
  gameId: number;
  puuid: LeaguePuuid;
}) => Promise<boolean>;

/**
 * Main function to check for active games across all tracked players.
 *
 * Detects when tracked players enter a game and sends a single notification
 * per game, listing all tracked players in that game.
 *
 * @param options.capturedByV2 - Asked for each game this pass has not
 *   tracked; a game V2 already took is skipped.
 * @param options.lobbyRetryDelayMs - Override the retry delay for pre-start
 *   lobby refetch attempts. Defaults to LOBBY_RETRY_DELAY_MS (2000ms).
 *   Pass 0 in tests to skip the real-time sleep.
 */
export async function checkActiveGames(options: {
  capturedByV2: PrematchV2CaptureCheck;
  lobbyRetryDelayMs?: number;
}): Promise<void> {
  const lobbyRetryDelayMs = options.lobbyRetryDelayMs ?? LOBBY_RETRY_DELAY_MS;
  if (shouldSkipCheck()) {
    return;
  }

  isCheckInProgress = true;
  const startTime = Date.now();
  checkStartTime = startTime;
  logger.info("🔍 Starting pre-match active game check");

  try {
    // The live-guild filter decides WORKLOAD only: which accounts this tick
    // spends Spectator calls on. It must never decide who a detected game's
    // notification is about — see `trackedPlayersInGame` below.
    const accountsWithState = await getAccountsWithState(
      prisma,
      getActiveServerIds(),
    );
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
    const trackedMatchIds = new Set(
      activeGames.flatMap((game) =>
        game.matchId === null ? [] : [game.matchId],
      ),
    );
    const trackedLegacyGameIds = new Set(
      activeGames
        .filter((game) => game.matchId === null)
        .map((game) => game.gameId),
    );
    const priorGameIdByPuuid = new Map<string, number>();
    for (const game of activeGames) {
      for (const puuid of game.trackedPuuids) {
        priorGameIdByPuuid.set(puuid, game.gameId);
      }
    }

    logger.info(
      `📊 ${activeGames.length.toString()} active game(s) currently tracked across ${priorGameIdByPuuid.size.toString()} player(s)`,
    );

    const currentTime = new Date();

    const eligible = accountsWithState.filter(
      ({ lastMatchTime, lastCheckedAt }) =>
        shouldCheckPlayer(lastMatchTime, lastCheckedAt, currentTime),
    );

    logger.info(
      `📊 ${eligible.length.toString()} / ${accountsWithState.length.toString()} account(s) eligible this cycle`,
    );

    // Sort by lastCheckedAt ascending (oldest first), then limit
    const sorted = eligible.toSorted(compareByLastCheckedAt);
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
        const initial = await pollPlayerForGame(puuid, region);
        if (initial === undefined) {
          continue;
        }

        // Lobbies (custom 5v5 SR and matched event modes alike) surface in
        // Spectator before all 10 players have loaded in. Retry a couple of
        // times in-process; if still incomplete, defer to the next 30s cron
        // tick (do NOT upsert) so a partial roster never reaches the builder.
        const gameInfo = isLikelyPreStartLobby(initial)
          ? await refetchLobbyUntilFilled(
              initial,
              puuid,
              region,
              lobbyRetryDelayMs,
            )
          : initial;

        if (isLikelyPreStartLobby(gameInfo)) {
          recordDeferredRoster(player.alias, gameInfo);
          continue;
        }

        const matchId = MatchIdSchema.parse(
          `${gameInfo.platformId}_${gameInfo.gameId.toString()}`,
        );

        // Check if this platform-qualified match is already tracked. Legacy
        // rows without a match ID retain numeric deduplication until they
        // expire, avoiding duplicate notifications during the migration.
        if (
          trackedMatchIds.has(matchId) ||
          trackedLegacyGameIds.has(gameInfo.gameId)
        ) {
          prematchDetectionsTotal.inc({ status: "already_tracked" });
          continue;
        }

        if (
          await options.capturedByV2({
            platformId: gameInfo.platformId,
            gameId: gameInfo.gameId,
            puuid,
          })
        ) {
          logger.info(
            `[${player.alias}] ⏭️  Skipping ${matchId} — the V2 prematch path already captured it`,
          );
          prematchDetectionsTotal.inc({ status: "owned_by_v2" });
          trackedMatchIds.add(matchId);
          continue;
        }

        // Find ALL tracked players in this game's participants — the AUDIENCE:
        // whose channels are notified, whose Classic participation is awarded,
        // and which PUUIDs the ActiveGame row records. Read unfiltered, not from
        // the workload roster above: `getActiveServerIds()` fails open while the
        // gateway is not ready but NARROWS once it is, so a guild removed
        // mid-match would otherwise silently drop its players from a game the
        // rest of the roster is still being told about.
        // KNOWN LIMITATION: matched by puuid only, so privacy-scrubbed players
        // (null puuid in Spectator-V5) are not matched here and are dropped from
        // the pre-match notification/image. This is accepted data loss.
        const trackedPlayersInGame: PlayerConfigEntry[] =
          await getAccountConfigsByPuuids(
            gameInfo.participants.flatMap((participant) => {
              const parsed = LeaguePuuidSchema.safeParse(participant.puuid);
              return parsed.success ? [parsed.data] : [];
            }),
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

        // Persist to DB (the platform-qualified match ID is unique; upsert is
        // safe under concurrent detection from different polled players)
        await upsertActiveGame(matchId, gameInfo.gameId, trackedPuuidsInGame);

        // Mark this game as tracked for the rest of this run so subsequent
        // players in the same lobby don't re-detect it
        trackedMatchIds.add(matchId);
        for (const p of trackedPuuidsInGame) {
          priorGameIdByPuuid.set(p, gameInfo.gameId);
        }

        // Persist the observation and send the notification. Failures before
        // delivery clear the dedup row so the next poll retries; failures
        // after delivery retain it to prevent duplicate Discord messages.
        const prematchMessageIds = await processPrematchWithRetryCleanup({
          matchId,
          gameInfo,
          trackedPlayers: trackedPlayersInGame,
        });
        await recordPrematchMessageIds(matchId, prematchMessageIds);

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

function compareByLastCheckedAt(
  left: { lastCheckedAt: Date | undefined },
  right: { lastCheckedAt: Date | undefined },
): number {
  return (
    (left.lastCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
    (right.lastCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
  );
}
