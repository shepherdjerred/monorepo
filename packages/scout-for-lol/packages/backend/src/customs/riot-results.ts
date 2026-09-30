import {
  CustomGameStateSchema,
  CustomNightStateSchema,
  CustomTeamSchema,
  CustomWinnerSchema,
  MatchIdSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";

export type ManagedCustomResultSource = "RIOT" | "SCOUT_CLIENT";

function resultAuditAttribution(source: ManagedCustomResultSource) {
  return source === "SCOUT_CLIENT"
    ? {
        actorId: "scout-client:canonical-match",
        action: "SCOUT_CLIENT_RESULT_VERIFIED",
      }
    : { actorId: "riot:match-v5", action: "RIOT_RESULT_VERIFIED" };
}

/**
 * Which historical Tournament API lobby, if any, a Match-V5 payload belongs
 * to. New managed customs are located by their observed roster instead.
 *
 * Exported because the V2 per-match core needs the SAME rule to decide whether
 * a match has a managed custom result to finalize at all. A second copy of "a
 * lobby is matched by its code, or by the match id once one was recorded"
 * could drift, and then V2 would gate on one rule while
 * {@link finalizeManagedCustomResult} finalized on another.
 */
export function historicalTournamentLobbyIdentity(
  matchId: string,
  tournamentCode: string | undefined,
) {
  return tournamentCode === undefined || tournamentCode.length === 0
    ? { matchId }
    : { code: tournamentCode };
}

const observedCustomGameInclude = {
  participants: true,
  night: true,
} as const;

/**
 * Resolve a scheduled Custom game from the exact match identity attached by an
 * accepted live post-game observation. A lobby roster alone is not sufficient:
 * the same players can create another game while an earlier result is pending.
 */
export async function findObservedCustomGame(
  client: ExtendedPrismaClient,
  match: RawMatch,
) {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const bound = await client.customGame.findFirst({
    where: { matchId },
    include: observedCustomGameInclude,
  });
  return bound;
}

function resultDisposition(
  rawState: string,
  gameId: string,
): "PROJECT" | "VOID" {
  const state = CustomGameStateSchema.parse(rawState);
  if (state === "VOID") return "VOID";
  if (
    state === "LOBBY_READY" ||
    state === "PLAYING" ||
    state === "RESULT_PENDING"
  )
    return "PROJECT";
  throw new Error(
    `Custom game ${gameId} reached Match-V5 in unexpected state ${state}`,
  );
}

function requireCompleteRoster(participantCount: number, gameId: string): void {
  if (participantCount !== 10) {
    throw new Error(
      `Custom game ${gameId} must have 10 participants before result finalization`,
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
  if (state === "LOBBY_READY" || state === "PLAYING") {
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

type ObservedCustomGame = NonNullable<
  Awaited<ReturnType<typeof findObservedCustomGame>>
>;

function verifiedResultNightId(
  game: ObservedCustomGame,
  matchId: string,
): string | null {
  if (game.state !== "VERIFIED") return null;
  if (game.matchId !== matchId) {
    throw new Error(
      `Verified Custom game ${game.id} is bound to another match`,
    );
  }
  return game.nightId;
}

async function projectParticipantResults(
  transaction: Db,
  game: ObservedCustomGame,
  match: RawMatch,
  matchId: string,
) {
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
  return requireWinner(winningTeams, matchId);
}

/**
 * Finalizes an observed managed Custom game and, when present, its historical
 * Tournament API row atomically. Called only after authoritative S3 ingestion
 * and before player cursors move.
 */
export async function finalizeManagedCustomResult(
  client: ExtendedPrismaClient,
  match: RawMatch,
  resultSource: ManagedCustomResultSource = "RIOT",
): Promise<string | undefined> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const observedGame = await findObservedCustomGame(client, match);

  return client.$transaction(async (transaction) => {
    const lobby = await transaction.tournamentLobby.findFirst({
      where: historicalTournamentLobbyIdentity(
        matchId,
        match.info.tournamentCode,
      ),
      include: {
        customGame: {
          include: { participants: true, night: true },
        },
      },
    });
    if (lobby?.state === "reported") return lobby.customGame?.nightId;

    const game =
      observedGame === null
        ? lobby?.customGame
        : await transaction.customGame.findUnique({
            where: { id: observedGame.id },
            include: observedCustomGameInclude,
          });
    if (game === null) {
      if (lobby === null) return;
      await transaction.tournamentLobby.update({
        where: { id: lobby.id },
        data: { matchId, state: "reported" },
      });
      return;
    }
    if (game === undefined) return;

    const verifiedNightId = verifiedResultNightId(game, matchId);
    if (verifiedNightId !== null) return verifiedNightId;

    if (resultDisposition(game.state, game.id) === "VOID") {
      if (lobby === null) return;
      await transaction.tournamentLobby.update({
        where: { id: lobby.id },
        data: { matchId, state: "reported" },
      });
      return;
    }
    const winner = await projectParticipantResults(
      transaction,
      game,
      match,
      matchId,
    );
    const completedAt = new Date(match.info.gameEndTimestamp);

    const gameUpdated = await transaction.customGame.updateMany({
      where: {
        id: game.id,
        state: { in: ["LOBBY_READY", "PLAYING", "RESULT_PENDING"] },
      },
      data: { state: "VERIFIED", winner, completedAt, matchId },
    });
    if (gameUpdated.count !== 1) {
      throw new Error(
        `Custom game ${game.id} changed during result finalization`,
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
        `Custom night ${game.nightId} changed during result finalization`,
      );
    }
    const auditAttribution = resultAuditAttribution(resultSource);
    await transaction.customAuditEvent.create({
      data: {
        nightId: game.nightId,
        gameId: game.id,
        revision: nextRevision,
        actorId: auditAttribution.actorId,
        action: auditAttribution.action,
        payload: JSON.stringify({ matchId, winner }),
        source: resultSource,
        createdAt: completedAt,
      },
    });
    if (lobby !== null) {
      await transaction.tournamentLobby.update({
        where: { id: lobby.id },
        data: { matchId, state: "reported" },
      });
    }
    return game.nightId;
  });
}
