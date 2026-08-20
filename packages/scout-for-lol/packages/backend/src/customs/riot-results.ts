import {
  CustomGameSnapshotSchema,
  CustomNightSnapshotSchema,
  MatchIdSchema,
  type CustomGameSnapshot,
  type CustomNightSnapshot,
  type CustomTeam,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";
import { recordPendingVoiceReturn } from "#src/customs/result-voice.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import {
  hasActiveTournamentCodeProvisioning,
  refreshSnapshot,
} from "#src/customs/snapshot.ts";
import {
  createGameTournamentCode,
  createNightTournament,
  type RawTournamentGame,
  type TournamentFetch,
} from "#src/customs/riot-tournament.ts";

function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

async function claimTournamentProvisioning(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  actorDiscordId: string;
  now: Date;
  expectedRevision: number | undefined;
}): Promise<CustomMutationResult & { claimId?: string }> {
  if (
    params.expectedRevision !== undefined &&
    params.snapshot.revision !== params.expectedRevision
  ) {
    return { applied: false, snapshot: params.snapshot };
  }
  const game = currentGame(params.snapshot);
  if (game.state !== "CODE_PENDING")
    throw new Error("Custom game is not waiting for a Tournament code");
  if (hasActiveTournamentCodeProvisioning(game, params.now)) {
    return { applied: false, snapshot: params.snapshot };
  }
  const claimId = globalThis.crypto.randomUUID();
  const previousClaimId = game.tournamentCodeProvisioning?.id ?? null;
  const result = await commitCustomMutation({
    prisma: params.prisma,
    nightId: params.snapshot.id,
    expectedRevision: params.expectedRevision ?? params.snapshot.revision,
    actorDiscordId: params.actorDiscordId,
    action: "TOURNAMENT_CODE_PROVISIONING_STARTED",
    payload: { claimId, previousClaimId },
    update: (current) => {
      const currentCustomGame = currentGame(current);
      if (currentCustomGame.id !== game.id)
        throw new Error("Custom game changed during Tournament provisioning");
      if (currentCustomGame.state !== "CODE_PENDING")
        throw new Error("Custom game is not waiting for a Tournament code");
      return CustomNightSnapshotSchema.parse({
        ...current,
        currentGame: {
          ...currentCustomGame,
          tournamentCodeProvisioning: {
            id: claimId,
            startedAt: params.now.toISOString(),
          },
        },
      });
    },
  });
  return result.applied ? { ...result, claimId } : result;
}

async function commitClaimedTournamentProvisioning(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  action: string;
  payload: unknown;
  update: (
    snapshot: CustomNightSnapshot,
    game: CustomGameSnapshot,
  ) => CustomNightSnapshot;
}): Promise<CustomMutationResult> {
  let latest = params.snapshot;
  for (;;) {
    const game = currentGame(latest);
    if (
      game.id !== params.gameId ||
      game.tournamentCodeProvisioning?.id !== params.claimId
    ) {
      return { applied: false, snapshot: latest };
    }
    const result = await commitCustomMutation({
      prisma: params.prisma,
      nightId: latest.id,
      expectedRevision: latest.revision,
      actorDiscordId: params.actorDiscordId,
      action: params.action,
      payload: params.payload,
      update: (current) => {
        const currentCustomGame = currentGame(current);
        if (
          currentCustomGame.id !== params.gameId ||
          currentCustomGame.tournamentCodeProvisioning?.id !== params.claimId
        ) {
          throw new Error("Tournament provisioning claim changed");
        }
        return params.update(current, currentCustomGame);
      },
    });
    if (result.applied) return result;
    latest = result.snapshot;
  }
}

export async function provisionCustomTournamentCode(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
  actorDiscordId: string;
  expectedRevision?: number;
  fetcher?: TournamentFetch;
}) {
  const snapshot = await getCustomNight(params.prisma, params.nightId);
  if (snapshot === null) throw new Error("Custom night not found");
  const claim = await claimTournamentProvisioning({
    prisma: params.prisma,
    snapshot,
    actorDiscordId: params.actorDiscordId,
    expectedRevision: params.expectedRevision,
    now: new Date(),
  });
  if (!claim.applied || claim.claimId === undefined) return claim;
  const game = currentGame(claim.snapshot);
  let latest = claim.snapshot;
  try {
    const tournamentId =
      latest.riotTournamentId ??
      (await createNightTournament(latest.id, params.fetcher));
    if (latest.riotTournamentId === null) {
      const tournament = await commitClaimedTournamentProvisioning({
        prisma: params.prisma,
        snapshot: latest,
        gameId: game.id,
        claimId: claim.claimId,
        actorDiscordId: params.actorDiscordId,
        action: "RIOT_TOURNAMENT_CREATED",
        payload: { tournamentId },
        update: (current) =>
          CustomNightSnapshotSchema.parse({
            ...current,
            riotTournamentId: tournamentId,
          }),
      });
      if (!tournament.applied)
        throw new Error("Tournament provisioning claim was lost");
      latest = tournament.snapshot;
    }
    const tournamentCode = await createGameTournamentCode({
      tournamentId,
      nightId: latest.id,
      game: currentGame(latest),
      fetcher: params.fetcher,
    });
    const finalized = await commitClaimedTournamentProvisioning({
      prisma: params.prisma,
      snapshot: latest,
      gameId: game.id,
      claimId: claim.claimId,
      actorDiscordId: params.actorDiscordId,
      action: "TOURNAMENT_CODE_CREATED",
      payload: { tournamentId, tournamentCode },
      update: (current, currentCustomGame) =>
        CustomNightSnapshotSchema.parse({
          ...current,
          riotTournamentId: tournamentId,
          currentGame: {
            ...currentCustomGame,
            state: transitionCustomGame(currentCustomGame.state, {
              type: "CODE_CREATED",
            }),
            tournamentCode,
            tournamentCodeProvisioning: null,
          },
        }),
    });
    if (!finalized.applied)
      throw new Error("Tournament provisioning claim was lost");
    return finalized;
  } catch (error) {
    await commitClaimedTournamentProvisioning({
      prisma: params.prisma,
      snapshot: latest,
      gameId: game.id,
      claimId: claim.claimId,
      actorDiscordId: params.actorDiscordId,
      action: "TOURNAMENT_CODE_PROVISIONING_FAILED",
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
      update: (current, currentCustomGame) =>
        CustomNightSnapshotSchema.parse({
          ...current,
          currentGame: {
            ...currentCustomGame,
            tournamentCodeProvisioning: null,
          },
        }),
    });
    throw error;
  }
}

function winnerFromGame(
  game: CustomGameSnapshot,
  result: RawTournamentGame,
): CustomTeam {
  const winningPuuids = new Set(
    result.winningTeam.map((participant) => participant.puuid),
  );
  const winningTeams = new Set(
    game.participants
      .filter((participant) => winningPuuids.has(participant.puuid))
      .map((participant) => participant.team)
      .filter((team) => team !== null),
  );
  if (winningTeams.size !== 1)
    throw new Error("Riot result does not map to one drafted team");
  const winner = [...winningTeams][0];
  if (winner === undefined)
    throw new Error("Riot result has no drafted winner");
  return winner;
}

function verifiedGameState(game: CustomGameSnapshot) {
  let gameState = game.state;
  if (gameState === "LOBBY_READY")
    gameState = transitionCustomGame(gameState, { type: "GAME_STARTED" });
  if (
    gameState === "PLAYING" ||
    gameState === "RESULT_PENDING" ||
    gameState === "MANUAL"
  ) {
    gameState = transitionCustomGame(gameState, { type: "RIOT_RESULT" });
  } else {
    throw new Error(`Cannot apply Riot result while game is ${gameState}`);
  }
  return gameState;
}

function verifiedNightState(snapshot: CustomNightSnapshot) {
  let nightState = snapshot.state;
  if (nightState === "LOBBY_READY")
    nightState = transitionCustomNight(nightState, { type: "GAME_STARTED" });
  if (nightState === "PLAYING")
    nightState = transitionCustomNight(nightState, {
      type: "INTERMISSION_OPENED",
    });
  return nightState;
}

function refreshResultSnapshot(
  snapshot: CustomNightSnapshot,
  now: Date,
): CustomNightSnapshot {
  if (snapshot.state === "ENDED") return snapshot;
  return refreshSnapshot(snapshot, now);
}

export async function recordRiotTournamentResult(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
  result: RawTournamentGame;
}) {
  const now = new Date();
  const riotMatchId = MatchIdSchema.parse(
    `NA1_${params.result.gameId.toString()}`,
  );
  let snapshot = await getCustomNight(params.prisma, params.nightId);
  if (snapshot === null) throw new Error("Custom night not found");

  for (;;) {
    const gameRow = await params.prisma.customGame.findUnique({
      where: { tournamentCode: params.result.shortCode },
    });
    if (gameRow?.nightId !== snapshot.id)
      throw new Error("Tournament result code mismatch");
    const game = CustomGameSnapshotSchema.parse(JSON.parse(gameRow.snapshot));
    if (game.state === "VERIFIED") {
      if (game.riotMatchId === riotMatchId) return { applied: false, snapshot };
      throw new Error("Verified custom game received a different Riot match");
    }
    const winner = winnerFromGame(game, params.result);
    const gameState = verifiedGameState(game);
    const isCurrentGame = snapshot.currentGame?.id === game.id;
    const nightState = isCurrentGame
      ? verifiedNightState(snapshot)
      : snapshot.state;
    const mutation = await commitCustomMutation({
      prisma: params.prisma,
      nightId: snapshot.id,
      expectedRevision: snapshot.revision,
      actorDiscordId: "RIOT",
      action: "RIOT_RESULT_VERIFIED",
      payload: {
        tournamentCode: params.result.shortCode,
        riotMatchId,
        winner,
        replacedManual: game.resultSource === "MANUAL",
        disagreed: game.resultSource === "MANUAL" && game.winner !== winner,
      },
      update: (current) => {
        if (!isCurrentGame) return refreshResultSnapshot(current, now);
        const activeGame = currentGame(current);
        if (activeGame.id !== game.id)
          throw new Error("Current custom game changed during Riot result");
        return refreshResultSnapshot(
          {
            ...current,
            state: nightState,
            currentGame: {
              ...activeGame,
              state: gameState,
              winner,
              resultSource: "RIOT",
              resultDisagreement:
                game.resultSource === "MANUAL" && game.winner !== winner,
              riotMatchId,
              completedAt: now.toISOString(),
            },
          },
          now,
        );
      },
      additionalGames: isCurrentGame
        ? []
        : [
            {
              ...game,
              state: gameState,
              winner,
              resultSource: "RIOT",
              resultDisagreement:
                game.resultSource === "MANUAL" && game.winner !== winner,
              riotMatchId,
              completedAt: now.toISOString(),
            },
          ],
      auditGameId: game.id,
      allowEnded: true,
      ...(isCurrentGame
        ? {
            sideEffect: async (transaction, updated) => {
              await recordPendingVoiceReturn(transaction, updated);
            },
          }
        : {}),
    });
    if (mutation.applied) return mutation;
    snapshot = mutation.snapshot;
  }
}
