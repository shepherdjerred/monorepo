import type { ScoutClientObservation } from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma } from "#src/database/index.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import {
  lobbyParticipantPuuids,
  observedGameState,
  observedLobbyMatchesCustomSettings,
  observedLobbyMatchesDuelSettings,
  observedPostGameMatchId,
  sameRoster,
} from "#src/scout-client/lobby-payload.ts";
import { lobbyWasSuperseded } from "#src/scout-client/lobby-supersession.ts";

/**
 * Bind a complete observed lobby to one pending scheduled Custom game or duel.
 * The user creates the lobby normally; Scout reacts to the exact participant
 * roster and never provisions a lobby itself.
 */
export async function bindObservedLobby(
  observation: ScoutClientObservation,
): Promise<void> {
  if (
    observation.kind !== "lobby" ||
    observation.lobbyId === undefined ||
    observation.localPuuid === undefined
  ) {
    return;
  }
  const observed = lobbyParticipantPuuids(observation.payload);
  if (!observed.has(observation.localPuuid)) return;

  const [customGames, duelGames] = await Promise.all([
    prisma.customGame.findMany({
      where: {
        state: "LOBBY_READY",
        observedLobbyId: null,
      },
      include: {
        participants: true,
        auditEvents: {
          where: { action: "LOCAL_LOBBY_REQUESTED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.duelGame.findMany({
      where: {
        gameState: "code_ready",
        observedLobbyId: null,
        series: { seriesState: "code_ready" },
      },
      include: {
        series: {
          include: {
            competitorOne: { include: { members: true } },
            competitorTwo: { include: { members: true } },
          },
        },
      },
    }),
  ]);
  const capturedAt = new Date(observation.capturedAt).getTime();
  const matchingCustoms = customGames.filter(
    (game) =>
      sameRoster(observed, game.participants) &&
      observedLobbyMatchesCustomSettings(observation.payload, game) &&
      game.auditEvents[0] !== undefined &&
      game.auditEvents[0].createdAt.getTime() <= capturedAt,
  );
  const matchingDuels = duelGames.filter(
    (game) =>
      sameRoster(observed, [
        ...game.series.competitorOne.members,
        ...game.series.competitorTwo.members,
      ]) &&
      observedLobbyMatchesDuelSettings(observation.payload) &&
      game.updatedAt.getTime() <= capturedAt,
  );
  if (matchingCustoms.length + matchingDuels.length > 1) {
    throw new Error(
      `Observed lobby ${observation.lobbyId} matches more than one pending Scout game`,
    );
  }
  const custom = matchingCustoms[0];
  if (custom !== undefined) {
    await prisma.customGame.updateMany({
      where: { id: custom.id, observedLobbyId: null },
      data: {
        observedLobbyId: observation.lobbyId,
        lobbyObservationId: observation.observationId,
      },
    });
    return;
  }
  const duel = matchingDuels[0];
  if (duel !== undefined) {
    await prisma.duelGame.updateMany({
      where: { id: duel.id, observedLobbyId: null },
      data: {
        observedLobbyId: observation.lobbyId,
        lobbyObservationId: observation.observationId,
      },
    });
  }
}

async function eligibleBoundGames(
  observation: ScoutClientObservation,
  localPuuid: ReturnType<typeof LeaguePuuidSchema.parse>,
) {
  const observed = lobbyParticipantPuuids(observation.payload);
  const [customGames, duelGames] = await Promise.all([
    prisma.customGame.findMany({
      where: {
        matchId: null,
        observedLobbyId: { not: null },
        lobbyObservationId: { not: null },
        state: { in: ["LOBBY_READY", "PLAYING", "RESULT_PENDING"] },
        participants: { some: { puuid: localPuuid } },
      },
      include: { participants: true },
    }),
    prisma.duelGame.findMany({
      where: {
        matchId: null,
        observedLobbyId: { not: null },
        lobbyObservationId: { not: null },
        gameState: { in: ["code_ready", "in_progress"] },
        series: {
          seriesState: { in: ["code_ready", "in_progress"] },
          OR: [
            { competitorOne: { members: { some: { puuid: localPuuid } } } },
            { competitorTwo: { members: { some: { puuid: localPuuid } } } },
          ],
        },
      },
      include: {
        series: {
          include: {
            competitorOne: { include: { members: true } },
            competitorTwo: { include: { members: true } },
          },
        },
      },
    }),
  ]);
  const customCandidates = customGames.filter((game) =>
    sameRoster(observed, game.participants),
  );
  const duelCandidates = duelGames.filter((game) =>
    sameRoster(observed, [
      ...game.series.competitorOne.members,
      ...game.series.competitorTwo.members,
    ]),
  );
  const capturedAt = new Date(observation.capturedAt);
  const eligibleCustoms = [];
  for (const game of customCandidates) {
    const participantPuuids = game.participants.map(
      (participant) => participant.puuid,
    );
    if (!(await lobbyWasSuperseded(game, participantPuuids, capturedAt))) {
      eligibleCustoms.push(game);
    }
  }
  const eligibleDuels = [];
  for (const game of duelCandidates) {
    const participantPuuids = [
      ...game.series.competitorOne.members,
      ...game.series.competitorTwo.members,
    ].map((participant) => participant.puuid);
    if (!(await lobbyWasSuperseded(game, participantPuuids, capturedAt))) {
      eligibleDuels.push(game);
    }
  }
  if (eligibleCustoms.length + eligibleDuels.length > 1) {
    throw new Error(
      `Observed post-game ${observation.gameId ?? "unknown"} matches more than one bound Scout game`,
    );
  }
  return { custom: eligibleCustoms[0], duel: eligibleDuels[0] };
}

async function projectionBoundGames(
  observation: ScoutClientObservation,
  localPuuid: ReturnType<typeof LeaguePuuidSchema.parse>,
) {
  const [customGames, duelGames] = await Promise.all([
    prisma.customGame.findMany({
      where: {
        observedLobbyId: { not: null },
        lobbyObservationId: { not: null },
        state: { in: ["LOBBY_READY", "PLAYING", "RESULT_PENDING"] },
        participants: { some: { puuid: localPuuid } },
      },
      include: { night: true, participants: { select: { puuid: true } } },
    }),
    prisma.duelGame.findMany({
      where: {
        observedLobbyId: { not: null },
        lobbyObservationId: { not: null },
        gameState: { in: ["code_ready", "in_progress"] },
        series: {
          OR: [
            { competitorOne: { members: { some: { puuid: localPuuid } } } },
            { competitorTwo: { members: { some: { puuid: localPuuid } } } },
          ],
        },
      },
      include: {
        series: {
          include: {
            competitorOne: {
              include: { members: { select: { puuid: true } } },
            },
            competitorTwo: {
              include: { members: { select: { puuid: true } } },
            },
          },
        },
      },
    }),
  ]);
  const capturedAt = new Date(observation.capturedAt);
  const eligibleCustoms = [];
  for (const game of customGames) {
    const participantPuuids = game.participants.map(
      (participant) => participant.puuid,
    );
    if (!(await lobbyWasSuperseded(game, participantPuuids, capturedAt))) {
      eligibleCustoms.push(game);
    }
  }
  const eligibleDuels = [];
  for (const game of duelGames) {
    const participantPuuids = [
      ...game.series.competitorOne.members,
      ...game.series.competitorTwo.members,
    ].map((participant) => participant.puuid);
    if (!(await lobbyWasSuperseded(game, participantPuuids, capturedAt))) {
      eligibleDuels.push(game);
    }
  }
  if (eligibleCustoms.length + eligibleDuels.length > 1) {
    throw new Error(
      `Observer ${localPuuid} belongs to more than one active bound Scout game`,
    );
  }
  return { custom: eligibleCustoms[0], duel: eligibleDuels[0] };
}

/**
 * Attach an accepted live post-game identity to the one lobby-bound game.
 * A later lobby seen by any scheduled participant invalidates the old binding,
 * preventing a repeated roster from being attributed to an unfinished game.
 */
export async function bindObservedMatch(
  observation: ScoutClientObservation,
): Promise<void> {
  const matchId = observedPostGameMatchId(observation);
  if (matchId === null || observation.localPuuid === undefined) return;

  const localPuuid = LeaguePuuidSchema.parse(observation.localPuuid);
  const [existingCustom, existingDuel] = await Promise.all([
    prisma.customGame.findUnique({ where: { matchId }, select: { id: true } }),
    prisma.duelGame.findUnique({ where: { matchId }, select: { id: true } }),
  ]);
  if (existingCustom !== null && existingDuel !== null) {
    throw new Error(`Observed match ${matchId} is bound to two Scout games`);
  }
  if (existingCustom !== null || existingDuel !== null) return;

  const { custom, duel } = await eligibleBoundGames(observation, localPuuid);
  if (custom !== undefined) {
    const updated = await prisma.customGame.updateMany({
      where: { id: custom.id, matchId: null },
      data: { matchId },
    });
    if (updated.count !== 1) {
      throw new Error(
        `Custom game ${custom.id} changed while binding ${matchId}`,
      );
    }
    return;
  }
  if (duel !== undefined) {
    const updated = await prisma.duelGame.updateMany({
      where: { id: duel.id, matchId: null },
      data: { matchId },
    });
    if (updated.count !== 1) {
      throw new Error(`Duel game ${duel.id} changed while binding ${matchId}`);
    }
  }
}

/**
 * Project native gameflow into the already-bound Custom or duel game. The
 * observer identity, not a caller-supplied game id, locates the one active
 * bound game. The source lobby must still be current for its participant set;
 * ambiguity fails instead of moving either game speculatively.
 */
export async function projectObservedGameState(
  observation: ScoutClientObservation,
): Promise<void> {
  const projection = observedGameState(observation);
  if (projection === null || observation.localPuuid === undefined) return;

  const localPuuid = LeaguePuuidSchema.parse(observation.localPuuid);
  const { custom, duel } = await projectionBoundGames(observation, localPuuid);

  if (custom !== undefined) {
    const nightId = await prisma.$transaction(async (transaction) => {
      const current = await transaction.customGame.findUniqueOrThrow({
        where: { id: custom.id },
        include: { night: true },
      });
      if (current.state === projection) return current.nightId;
      if (current.state === "RESULT_PENDING") return current.nightId;
      if (
        !["LOBBY_READY", "PLAYING"].includes(current.state) ||
        !["LOBBY_READY", "PLAYING"].includes(current.night.state)
      ) {
        throw new Error(
          `Observed game ${current.id} cannot project ${projection} from ${current.state}`,
        );
      }
      const updated = await transaction.customGame.updateMany({
        where: {
          id: current.id,
          state: current.state,
        },
        data: {
          state: projection,
          ...(projection === "PLAYING" && current.startedAt === null
            ? { startedAt: new Date(observation.capturedAt) }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Observed game ${current.id} changed during local projection`,
        );
      }
      const revision = current.night.revision + 1;
      const nightUpdated = await transaction.customNight.updateMany({
        where: {
          id: current.nightId,
          state: current.night.state,
          revision: current.night.revision,
        },
        data: {
          state: "PLAYING",
          revision: { increment: 1 },
          lastActivityAt: new Date(observation.capturedAt),
        },
      });
      if (nightUpdated.count !== 1) {
        throw new Error(
          `Custom night ${current.nightId} changed during local projection`,
        );
      }
      await transaction.customAuditEvent.create({
        data: {
          nightId: current.nightId,
          gameId: current.id,
          revision,
          actorId: `scout-client:${observation.observationId}`,
          action:
            projection === "PLAYING"
              ? "LOCAL_GAME_IN_PROGRESS"
              : "LOCAL_RESULT_PENDING",
          payload: JSON.stringify({
            observationId: observation.observationId,
            observedLobbyId: current.observedLobbyId,
          }),
          source: "SCOUT_CLIENT",
          createdAt: new Date(observation.capturedAt),
        },
      });
      return current.nightId;
    });
    await publishCustomNightSnapshot(nightId);
    return;
  }

  if (duel === undefined) return;
  await prisma.$transaction(async (transaction) => {
    await transaction.duelGame.updateMany({
      where: { id: duel.id, gameState: "code_ready" },
      data: { gameState: "in_progress" },
    });
    await transaction.duelSeries.updateMany({
      where: { id: duel.seriesId, seriesState: "code_ready" },
      data: { seriesState: "in_progress" },
    });
  });
}
