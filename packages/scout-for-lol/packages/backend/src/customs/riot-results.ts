import {
  CustomGameStateSchema,
  CustomNightStateSchema,
  CustomTeamSchema,
  CustomWinnerSchema,
  MatchIdSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

function tournamentLobbyIdentity(
  matchId: string,
  tournamentCode: string | undefined,
) {
  return tournamentCode === undefined || tournamentCode.length === 0
    ? { matchId }
    : { code: tournamentCode };
}

function resultDisposition(
  rawState: string,
  gameId: string,
): "PROJECT" | "VOID" {
  const state = CustomGameStateSchema.parse(rawState);
  if (state === "VOID") return "VOID";
  if (state === "PLAYING" || state === "RESULT_PENDING") return "PROJECT";
  throw new Error(
    `Custom game ${gameId} reached Match-V5 in unexpected state ${state}`,
  );
}

function requireCompleteRoster(participantCount: number, gameId: string): void {
  if (participantCount !== 10) {
    throw new Error(
      `Custom game ${gameId} must have 10 participants before Riot finalization`,
    );
  }
}

function requireWinner(winningTeams: ReadonlySet<string>, matchId: string) {
  const values = [...winningTeams];
  if (values.length !== 1) {
    throw new Error(
      `Match ${matchId} did not produce exactly one winning custom team`,
    );
  }
  return CustomWinnerSchema.parse(values[0]);
}

function nightResultTransition(rawState: string, nightId: string) {
  const state = CustomNightStateSchema.parse(rawState);
  if (state === "PLAYING") {
    return {
      current: state,
      next: "INTERMISSION",
      updateActivity: true,
    } as const;
  }
  if (state === "ENDED") {
    return { current: state, next: "ENDED", updateActivity: false } as const;
  }
  throw new Error(
    `Custom night ${nightId} reached Match-V5 in unexpected state ${state}`,
  );
}

/**
 * Finalizes the Tournament lobby and its optional Customs game atomically.
 * Called only after authoritative S3 ingestion and before player cursors move.
 */
export async function finalizeTournamentResult(
  client: ExtendedPrismaClient,
  match: RawMatch,
): Promise<string | undefined> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);

  return client.$transaction(async (transaction) => {
    const lobby = await transaction.tournamentLobby.findFirst({
      where: tournamentLobbyIdentity(matchId, match.info.tournamentCode),
      include: {
        customGame: {
          include: { participants: true, night: true },
        },
      },
    });
    if (lobby === null) return;
    if (lobby.state === "reported") return lobby.customGame?.nightId;

    const game = lobby.customGame;
    if (game === null) {
      await transaction.tournamentLobby.update({
        where: { id: lobby.id },
        data: { matchId, state: "reported" },
      });
      return;
    }

    if (resultDisposition(game.state, game.id) === "VOID") {
      await transaction.tournamentLobby.update({
        where: { id: lobby.id },
        data: { matchId, state: "reported" },
      });
      return;
    }
    requireCompleteRoster(game.participants.length, game.id);

    const winningTeams = new Set<string>();
    for (const participant of game.participants) {
      const riotParticipant = match.info.participants.find(
        (candidate) => candidate.puuid === participant.puuid,
      );
      if (riotParticipant === undefined) {
        throw new Error(
          `Match ${matchId} is missing custom participant ${participant.puuid}`,
        );
      }
      const team = CustomTeamSchema.parse(participant.team);
      if (riotParticipant.win) winningTeams.add(team);
      await transaction.customGameParticipant.update({
        where: { id: participant.id },
        data: {
          championId: riotParticipant.championId,
          won: riotParticipant.win,
        },
      });
    }
    const winner = requireWinner(winningTeams, matchId);
    const completedAt = new Date(match.info.gameEndTimestamp);

    const gameUpdated = await transaction.customGame.updateMany({
      where: {
        id: game.id,
        state: { in: ["PLAYING", "RESULT_PENDING"] },
      },
      data: { state: "VERIFIED", winner, completedAt },
    });
    if (gameUpdated.count !== 1) {
      throw new Error(
        `Custom game ${game.id} changed during Riot finalization`,
      );
    }

    const nightTransition = nightResultTransition(
      game.night.state,
      game.nightId,
    );
    const nextRevision = game.night.revision + 1;
    const nightUpdated = await transaction.customNight.updateMany({
      where: {
        id: game.nightId,
        state: nightTransition.current,
        revision: game.night.revision,
      },
      data: {
        state: nightTransition.next,
        revision: { increment: 1 },
        ...(nightTransition.updateActivity
          ? { lastActivityAt: completedAt }
          : {}),
      },
    });
    if (nightUpdated.count !== 1) {
      throw new Error(
        `Custom night ${game.nightId} changed during Riot finalization`,
      );
    }
    await transaction.customAuditEvent.create({
      data: {
        nightId: game.nightId,
        gameId: game.id,
        revision: nextRevision,
        actorId: "riot:match-v5",
        action: "RIOT_RESULT_VERIFIED",
        payload: JSON.stringify({ matchId, winner }),
        source: "RIOT",
        createdAt: completedAt,
      },
    });
    await transaction.tournamentLobby.update({
      where: { id: lobby.id },
      data: { matchId, state: "reported" },
    });
    return game.nightId;
  });
}
