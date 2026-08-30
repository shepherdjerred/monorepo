import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { TournamentLobbyState } from "#src/league/tournament/lifecycle.ts";

type Projection = {
  readonly gameState: "PLAYING" | "RESULT_PENDING";
  readonly action: "RIOT_LOBBY_IN_GAME" | "RIOT_RESULT_PENDING";
};

function projectionFor(state: TournamentLobbyState): Projection | undefined {
  if (state === "in_game") {
    return { gameState: "PLAYING", action: "RIOT_LOBBY_IN_GAME" };
  }
  if (state === "resolved") {
    return { gameState: "RESULT_PENDING", action: "RIOT_RESULT_PENDING" };
  }
  return undefined;
}

/**
 * Projects Tournament-V5 progress into Customs without inventing a second
 * callback or result path. Riot entering the game owns PLAYING; resolving the
 * match ID owns RESULT_PENDING. Match-V5 ingestion alone owns VERIFIED.
 */
export async function projectTournamentLobbyToCustoms(
  client: ExtendedPrismaClient,
  lobbyId: number,
  state: TournamentLobbyState,
  now: Date,
): Promise<string | undefined> {
  const projection = projectionFor(state);
  if (projection === undefined) return undefined;
  const nightId = await client.$transaction(async (transaction) => {
    const lobby = await transaction.tournamentLobby.findUnique({
      where: { id: lobbyId },
      include: { customGame: { include: { night: true } } },
    });
    const game = lobby?.customGame;
    if (game === null || game === undefined) return;
    if (game.state === projection.gameState) return;
    if (
      !["LOBBY_READY", "PLAYING"].includes(game.state) ||
      game.night.state === "ENDED"
    ) {
      throw new Error(
        `Tournament lobby ${lobbyId.toString()} cannot project ${projection.gameState} into custom game ${game.id} from ${game.state}`,
      );
    }
    const gameUpdated = await transaction.customGame.updateMany({
      where: { id: game.id, state: { in: ["LOBBY_READY", "PLAYING"] } },
      data: {
        state: projection.gameState,
        ...(projection.gameState === "PLAYING" && game.startedAt === null
          ? { startedAt: now }
          : {}),
      },
    });
    if (gameUpdated.count !== 1) {
      throw new Error(`Custom game ${game.id} changed during Riot projection`);
    }
    const revision = game.night.revision + 1;
    const nightUpdated = await transaction.customNight.updateMany({
      where: { id: game.nightId, revision: game.night.revision },
      data: {
        state: "PLAYING",
        revision: { increment: 1 },
        lastActivityAt: now,
      },
    });
    if (nightUpdated.count !== 1) {
      throw new Error(
        `Custom night ${game.nightId} changed during Riot projection`,
      );
    }
    await transaction.customAuditEvent.create({
      data: {
        nightId: game.nightId,
        gameId: game.id,
        revision,
        actorId: "riot:tournament-v5",
        action: projection.action,
        payload: JSON.stringify({ lobbyId, state }),
        source: "RIOT",
        createdAt: now,
      },
    });
    return game.nightId;
  });
  return nightId;
}

/**
 * Resolved lobbies no longer call Tournament-V5, but a revision race may have
 * committed the lobby transition before its Customs projection. Keep that
 * recovery work on the database path until the game reaches RESULT_PENDING.
 */
export async function resolvedCustomLobbyProjectionCandidates(
  client: ExtendedPrismaClient,
): Promise<readonly number[]> {
  const lobbies = await client.tournamentLobby.findMany({
    where: {
      state: "resolved",
      customGame: {
        is: {
          state: { in: ["LOBBY_READY", "PLAYING"] },
          night: { state: { not: "ENDED" } },
        },
      },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return lobbies.map((lobby) => lobby.id);
}
