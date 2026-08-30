import {
  LeaguePuuidSchema,
  MatchIdSchema,
  type LeaguePuuid,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { CircuitBreaker } from "#src/utils/circuit-breaker.ts";
import {
  getGamesByCode,
  getLobbyEvents,
} from "#src/league/api/tournament/client.ts";
import { supportsGamesByCode } from "#src/league/api/tournament/mode.ts";
import type { TournamentApiMode } from "#src/configuration/tournament-mode.ts";
import {
  tournamentApiMode,
  tournamentMaxOpenLobbies,
} from "#src/config/dynamic.ts";
import {
  entersChampSelect,
  isTerminal,
  nextState,
  type TournamentLobbyState,
} from "#src/league/tournament/lifecycle.ts";
import {
  claimLobbiesToPoll,
  countLobbiesByState,
  expireResolvedLobbies,
  updateLobby,
  type TournamentLobbyRecord,
} from "#src/league/tournament/lobby-store.ts";
import { deliverLobbyPrematch } from "#src/league/tournament/prematch-delivery.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";
import {
  recordPrematchMessageIds,
  upsertActiveGame,
} from "#src/league/tasks/prematch/active-game-queries.ts";
import {
  tournamentApiModeGauge,
  tournamentLobbiesTotal,
  tournamentLobbyStateGauge,
  tournamentLobbyTransitionsTotal,
  tournamentMatchLinkTotal,
  tournamentUnknownLobbyEventsTotal,
} from "#src/metrics/tournament.ts";
import {
  projectTournamentLobbyToCustoms,
  resolvedCustomLobbyProjectionCandidates,
} from "#src/customs/lobby-projection.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";

const logger = createLogger("tournament-poller");

/**
 * Mirrors the spectator poller's breaker. The tournament API has its own
 * per-method limits, and a sustained outage there must not keep costing calls.
 */
const tournamentCircuit = new CircuitBreaker("tournament-api");

/**
 * Guards against a slow tick overlapping the next one, the same way
 * `checkActiveGames` and `checkMatchHistory` do. Force-reset after
 * `CHECK_TIMEOUT_MS` so a crashed tick cannot wedge the poller forever.
 */
const CHECK_TIMEOUT_MS = 3 * 60 * 1000;
let checkInProgress = false;
let checkStartedAt = 0;

function shouldSkipCheck(): boolean {
  if (!checkInProgress) return false;
  if (Date.now() - checkStartedAt > CHECK_TIMEOUT_MS) {
    logger.warn("Previous tournament poll exceeded its timeout; forcing reset");
    return false;
  }
  return true;
}

/**
 * Resolves the Riot match ID for a lobby whose game has started.
 *
 * Two sources, in order of directness:
 *
 * 1. `games/by-code`, which exists only on the live API. Riot's own note is
 *    that a game appearing here means a callback was attempted.
 * 2. A single spectator probe on a joined player. Unreliable for customs, but
 *    free to try and it is also the only option in stub mode.
 *
 * `undefined` is not a failure — the game may simply not be over yet, and the
 * next tick tries again.
 */
async function resolveMatchId(
  lobby: TournamentLobbyRecord,
  mode: TournamentApiMode,
): Promise<
  | { matchId: string; gameId: number; participantPuuids: LeaguePuuid[] }
  | undefined
> {
  if (supportsGamesByCode(mode)) {
    const games = await getGamesByCode({ mode }, lobby.code);
    const game = games?.[0];
    if (game !== undefined) {
      return {
        matchId: `${lobby.platformId}_${game.gameId.toString()}`,
        gameId: game.gameId,
        participantPuuids: [...game.winningTeam, ...game.losingTeam].map(
          (participant) => LeaguePuuidSchema.parse(participant.puuid),
        ),
      };
    }
  }

  const probeTarget = lobby.joinedPuuids[0] ?? lobby.bluePuuids[0];
  if (probeTarget === undefined) return undefined;

  // Re-validated rather than asserted: the column is TEXT and a corrupted row
  // should fail loudly here, not be handed to Riot as a malformed PUUID.
  const spectator = await getActiveGame(
    LeaguePuuidSchema.parse(probeTarget),
    lobby.region,
  );
  const game = spectator.game;
  if (game === undefined) return undefined;

  return {
    matchId: `${game.platformId}_${game.gameId.toString()}`,
    gameId: game.gameId,
    participantPuuids: game.participants.flatMap((participant) =>
      participant.puuid === null
        ? []
        : [LeaguePuuidSchema.parse(participant.puuid)],
    ),
  };
}

/**
 * Writes the ActiveGame row the post-match report replies against.
 *
 * This is linkage only. The tournament poller never ingests the match itself:
 * the per-player match-history cursor already does that, and its S3 write is
 * what gates the cursor advance — the strongest durability invariant in the
 * codebase. A second ingest path would have to re-prove exactly-once against
 * it for nothing.
 */
async function linkMatch(
  lobby: TournamentLobbyRecord,
  mode: TournamentApiMode,
): Promise<TournamentLobbyState | undefined> {
  const resolved = await resolveMatchId(lobby, mode);
  if (resolved === undefined) {
    if (!supportsGamesByCode(mode)) {
      tournamentMatchLinkTotal.inc({ status: "stub_unsupported" });
    }
    return undefined;
  }

  const trackedAccounts = await prisma.account.findMany({
    where: {
      serverId: lobby.serverId,
      puuid: { in: resolved.participantPuuids },
    },
    select: { puuid: true },
  });
  const trackedPuuids = trackedAccounts.map((account) => account.puuid);
  if (trackedPuuids.length === 0) {
    tournamentMatchLinkTotal.inc({ status: "no_tracked_player" });
    return undefined;
  }

  const matchId = MatchIdSchema.parse(resolved.matchId);
  await upsertActiveGame(matchId, resolved.gameId, trackedPuuids);

  await updateLobby(prisma, lobby.id, {
    matchId: resolved.matchId,
    gameId: BigInt(resolved.gameId),
    ...(lobby.prematchMessageIds === undefined
      ? {}
      : { prematchMessageIds: lobby.prematchMessageIds }),
  });

  // Copy the prematch message IDs across so the post-match report replies to
  // the card this poller sent, using the unchanged
  // getPrematchMessageIdsForMatchIdOrEmpty path.
  if (lobby.prematchMessageIds !== undefined) {
    await recordPrematchMessageIds(
      matchId,
      new Map(Object.entries(lobby.prematchMessageIds)),
    );
  }

  tournamentMatchLinkTotal.inc({ status: "linked" });
  logger.info(`🔗 Linked lobby ${lobby.code} to ${resolved.matchId}`);
  return "resolved";
}

async function pollLobby(
  lobby: TournamentLobbyRecord,
  mode: TournamentApiMode,
): Promise<void> {
  const events = await getLobbyEvents({ mode }, lobby.code);
  // A failed poll is not information. Leave the lobby exactly as it was and let
  // the next tick try again. Feeding the failure to the breaker is what stops a
  // sustained tournament-API outage costing a call per lobby per 20 seconds;
  // its own rate limiting keeps that out of Sentry.
  if (events === undefined) {
    tournamentCircuit.recordFailure(
      new Error(`Tournament lobby-events failed for ${lobby.code}`),
      { source: "tournament-lobby-events", code: lobby.code },
    );
    return;
  }
  tournamentCircuit.recordSuccess();

  const result = nextState({
    current: lobby.state,
    events,
    now: new Date(),
    expiresAt: lobby.expiresAt,
  });

  for (const eventType of result.unknownEventTypes) {
    tournamentUnknownLobbyEventsTotal.inc({ event_type: eventType });
  }
  for (const transition of result.transitions) {
    tournamentLobbyTransitionsTotal.inc({
      from: transition.from,
      to: transition.to,
    });
  }

  // Entering champ select is what sends the card, and a state is only ever
  // entered once — that is the whole no-duplicate-notification guarantee.
  const currentLobby = { ...lobby, joinedPuuids: [...result.joinedPuuids] };
  const messageIds = entersChampSelect(result.transitions)
    ? await deliverLobbyPrematch(currentLobby)
    : lobby.prematchMessageIds;

  let state = result.state;
  if (state === "in_game" || state === "resolved") {
    const linked = await linkMatch(
      { ...currentLobby, prematchMessageIds: messageIds, state },
      mode,
    );
    if (linked !== undefined) state = linked;
  }

  if (isTerminal(state) && state !== lobby.state) {
    tournamentLobbiesTotal.inc({ action: state });
  }

  const now = new Date();
  await updateLobby(prisma, lobby.id, {
    state,
    joinedPuuids: [...result.joinedPuuids],
    processedEventCount: events.length,
    ...(events.at(-1) === undefined
      ? {}
      : { lastEventTimestamp: events.at(-1)?.timestamp }),
    ...(messageIds === undefined ? {} : { prematchMessageIds: messageIds }),
    markPolled: true,
  });
  const customNightId = await projectTournamentLobbyToCustoms(
    prisma,
    lobby.id,
    state,
    now,
  );
  if (customNightId !== undefined) {
    await publishCustomNightSnapshot(customNightId);
  }
}

/**
 * One tick of the tournament lobby poller.
 *
 * Runs on its own 20-second cron rather than inside `checkPreMatch`, which
 * already carries six tasks under one lock — a seventh would couple a
 * tournament-API outage to the betting sweeps. 20 seconds also guarantees at
 * least two polls inside a ~40-second blind-pick champ select, and lands
 * between the 30s prematch tick and the 60s postmatch tick.
 */
export async function checkTournamentLobbies(): Promise<void> {
  if (shouldSkipCheck()) {
    logger.info("⏭️ Tournament poll already in progress; skipping this tick");
    return;
  }

  checkInProgress = true;
  checkStartedAt = Date.now();
  try {
    const mode = tournamentApiMode();
    tournamentApiModeGauge.set(mode === "live" ? 1 : 0);

    const unresolvedCustomProjections =
      await resolvedCustomLobbyProjectionCandidates(prisma);
    for (const lobbyId of unresolvedCustomProjections) {
      try {
        const customNightId = await projectTournamentLobbyToCustoms(
          prisma,
          lobbyId,
          "resolved",
          new Date(),
        );
        if (customNightId !== undefined) {
          await publishCustomNightSnapshot(customNightId);
        }
      } catch (error) {
        logger.error(
          `Failed to recover Customs projection for lobby ${lobbyId.toString()}`,
          error,
        );
      }
    }

    const expiredResolved = await expireResolvedLobbies(prisma, new Date());
    if (expiredResolved > 0) {
      tournamentLobbiesTotal.inc({ action: "expired" }, expiredResolved);
    }

    const lobbies = await claimLobbiesToPoll(
      prisma,
      tournamentMaxOpenLobbies(),
    );
    for (const lobby of lobbies) {
      if (tournamentCircuit.shouldSkip()) {
        logger.info("Tournament API circuit open; skipping remaining lobbies");
        break;
      }
      try {
        await pollLobby(lobby, mode);
      } catch (error) {
        // One bad lobby must not stop the others; its own next tick retries.
        logger.error(`Failed to poll lobby ${lobby.code}`, error);
      }
    }

    const counts = await countLobbiesByState(prisma);
    for (const [state, count] of counts) {
      tournamentLobbyStateGauge.set({ state }, count);
    }
  } finally {
    checkInProgress = false;
  }
}
