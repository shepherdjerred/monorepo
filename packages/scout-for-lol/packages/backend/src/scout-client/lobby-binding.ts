import type { ScoutClientObservation } from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma } from "#src/database/index.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import {
  lobbyParticipantPuuids,
  observedGameState,
  observedLobbyMatchesCustomSettings,
  observedLobbyMatchesCustomTeams,
  observedLobbyMatchesDuelSettings,
  observedLobbyMatchesDuelTeams,
  observedMatchEndedAt,
  observedPostGameMatchId,
  sameRoster,
} from "#src/scout-client/lobby-payload.ts";
import {
  replaceableLobbyBindings,
  withoutSupersededBindings,
} from "#src/scout-client/lobby-supersession.ts";

type LobbyBoundGame = {
  readonly observedLobbyId: string | null;
  readonly lobbyObservationId: string | null;
};

type BindingCandidates<Game extends LobbyBoundGame> = {
  readonly games: readonly Game[];
  readonly participantPuuids: (game: Game) => readonly string[];
};

async function currentBindingResolution<
  Custom extends LobbyBoundGame,
  Duel extends LobbyBoundGame,
>(
  customs: BindingCandidates<Custom>,
  duels: BindingCandidates<Duel>,
  capturedAt: Date,
) {
  const [eligibleCustoms, eligibleDuels] = await Promise.all([
    withoutSupersededBindings(
      customs.games,
      customs.participantPuuids,
      capturedAt,
    ),
    withoutSupersededBindings(duels.games, duels.participantPuuids, capturedAt),
  ]);
  if (eligibleCustoms.length + eligibleDuels.length > 1) {
    return { kind: "ambiguous" } as const;
  }
  return {
    kind: "resolved",
    custom: eligibleCustoms[0],
    duel: eligibleDuels[0],
  } as const;
}

/**
 * Bind a complete observed lobby to one pending scheduled Custom game or duel.
 * The user creates the lobby normally; Scout reacts to the exact participant
 * roster and never provisions a lobby itself.
 */
export async function bindObservedLobby(
  observation: ScoutClientObservation,
): Promise<"ambiguous" | "bound" | "ignored" | "unmatched"> {
  if (
    observation.kind !== "lobby" ||
    observation.lobbyId === undefined ||
    observation.localPuuid === undefined
  ) {
    return "ignored";
  }
  const observedLobby = {
    capturedAt: observation.capturedAt,
    lobbyId: observation.lobbyId,
  };
  const observed = lobbyParticipantPuuids(observation.payload);
  if (!observed.has(observation.localPuuid)) return "ignored";

  const [customGames, duelGames] = await Promise.all([
    prisma.customGame.findMany({
      where: {
        state: "LOBBY_READY",
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
  const rosterMatchingCustoms = customGames.filter(
    (game) =>
      sameRoster(observed, game.participants) &&
      observedLobbyMatchesCustomSettings(observation.payload, game) &&
      observedLobbyMatchesCustomTeams(observation.payload, game.participants) &&
      game.auditEvents[0] !== undefined &&
      game.auditEvents[0].createdAt.getTime() <= capturedAt,
  );
  const rosterMatchingDuels = duelGames.filter(
    (game) =>
      sameRoster(observed, [
        ...game.series.competitorOne.members,
        ...game.series.competitorTwo.members,
      ]) &&
      observedLobbyMatchesDuelSettings(observation.payload) &&
      observedLobbyMatchesDuelTeams(
        observation.payload,
        game.series.competitorOne.members,
        game.series.competitorTwo.members,
      ) &&
      game.updatedAt.getTime() <= capturedAt,
  );
  const [matchingCustoms, matchingDuels] = await Promise.all([
    replaceableLobbyBindings(
      rosterMatchingCustoms,
      (game) => game.participants.map((participant) => participant.puuid),
      observedLobby,
    ),
    replaceableLobbyBindings(
      rosterMatchingDuels,
      (game) =>
        [
          ...game.series.competitorOne.members,
          ...game.series.competitorTwo.members,
        ].map((participant) => participant.puuid),
      observedLobby,
    ),
  ]);
  if (matchingCustoms.length + matchingDuels.length > 1) {
    return "ambiguous";
  }
  const custom = matchingCustoms[0];
  if (custom !== undefined) {
    if (custom.lobbyObservationId === observation.observationId) return "bound";
    const updated = await prisma.customGame.updateMany({
      where: {
        id: custom.id,
        state: "LOBBY_READY",
        observedLobbyId: custom.observedLobbyId,
        lobbyObservationId: custom.lobbyObservationId,
      },
      data: {
        observedLobbyId: observation.lobbyId,
        lobbyObservationId: observation.observationId,
      },
    });
    return updated.count === 1 ? "bound" : "unmatched";
  }
  const duel = matchingDuels[0];
  if (duel !== undefined) {
    if (duel.lobbyObservationId === observation.observationId) return "bound";
    const updated = await prisma.duelGame.updateMany({
      where: {
        id: duel.id,
        gameState: "code_ready",
        observedLobbyId: duel.observedLobbyId,
        lobbyObservationId: duel.lobbyObservationId,
        series: { seriesState: "code_ready" },
      },
      data: {
        observedLobbyId: observation.lobbyId,
        lobbyObservationId: observation.observationId,
      },
    });
    return updated.count === 1 ? "bound" : "unmatched";
  }
  return "unmatched";
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
  return currentBindingResolution(
    {
      games: customCandidates,
      participantPuuids: (game) =>
        game.participants.map((participant) => participant.puuid),
    },
    {
      games: duelCandidates,
      participantPuuids: (game) =>
        [
          ...game.series.competitorOne.members,
          ...game.series.competitorTwo.members,
        ].map((participant) => participant.puuid),
    },
    observedMatchEndedAt(observation),
  );
}

async function projectionBoundGames(
  observation: ScoutClientObservation,
  localPuuid: ReturnType<typeof LeaguePuuidSchema.parse>,
  postGameMatchId: string | null,
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
  const observedRoster = lobbyParticipantPuuids(observation.payload);
  const matchingCustomGames =
    postGameMatchId === null
      ? customGames.filter((game) =>
          sameRoster(observedRoster, game.participants),
        )
      : customGames.filter((game) => game.matchId === postGameMatchId);
  const matchingDuelGames =
    postGameMatchId === null
      ? duelGames.filter((game) =>
          sameRoster(observedRoster, [
            ...game.series.competitorOne.members,
            ...game.series.competitorTwo.members,
          ]),
        )
      : duelGames.filter((game) => game.matchId === postGameMatchId);
  return currentBindingResolution(
    {
      games: matchingCustomGames,
      participantPuuids: (game) =>
        game.participants.map((participant) => participant.puuid),
    },
    {
      games: matchingDuelGames,
      participantPuuids: (game) =>
        [
          ...game.series.competitorOne.members,
          ...game.series.competitorTwo.members,
        ].map((participant) => participant.puuid),
    },
    postGameMatchId === null
      ? new Date(observation.capturedAt)
      : observedMatchEndedAt(observation),
  );
}

/**
 * Attach an accepted live post-game identity to the one lobby-bound game.
 * A later lobby seen by any scheduled participant invalidates the old binding,
 * preventing a repeated roster from being attributed to an unfinished game.
 */
export async function bindObservedMatch(
  observation: ScoutClientObservation,
): Promise<"already_bound" | "ambiguous" | "bound" | "ignored" | "unmatched"> {
  const matchId = observedPostGameMatchId(observation);
  if (matchId === null || observation.localPuuid === undefined)
    return "ignored";

  const localPuuid = LeaguePuuidSchema.parse(observation.localPuuid);
  const [existingCustom, existingDuel] = await Promise.all([
    prisma.customGame.findUnique({ where: { matchId }, select: { id: true } }),
    prisma.duelGame.findUnique({ where: { matchId }, select: { id: true } }),
  ]);
  if (existingCustom !== null && existingDuel !== null) {
    throw new Error(`Observed match ${matchId} is bound to two Scout games`);
  }
  if (existingCustom !== null || existingDuel !== null) return "already_bound";

  const resolution = await eligibleBoundGames(observation, localPuuid);
  if (resolution.kind === "ambiguous") return "ambiguous";
  const { custom, duel } = resolution;
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
    return "bound";
  }
  if (duel !== undefined) {
    const updated = await prisma.duelGame.updateMany({
      where: { id: duel.id, matchId: null },
      data: { matchId },
    });
    if (updated.count !== 1) {
      throw new Error(`Duel game ${duel.id} changed while binding ${matchId}`);
    }
    return "bound";
  }
  return "unmatched";
}

/**
 * Project native gameflow into the already-bound Custom or duel game. The
 * observer identity, not a caller-supplied game id, locates the one active
 * bound game. The source lobby must still be current for its participant set;
 * ambiguity fails instead of moving either game speculatively.
 */
export async function projectObservedGameState(
  observation: ScoutClientObservation,
): Promise<"ambiguous" | "ignored" | "projected" | "unmatched"> {
  const projection = observedGameState(observation);
  if (projection === null || observation.localPuuid === undefined) {
    return "ignored";
  }
  const postGameMatchId =
    observation.kind === "post_game"
      ? observedPostGameMatchId(observation)
      : null;
  if (postGameMatchId === null && observation.kind === "post_game") {
    return "ignored";
  }

  const localPuuid = LeaguePuuidSchema.parse(observation.localPuuid);
  const resolution = await projectionBoundGames(
    observation,
    localPuuid,
    postGameMatchId,
  );
  if (resolution.kind === "ambiguous") return "ambiguous";
  const { custom, duel } = resolution;

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
    return "projected";
  }

  if (duel === undefined) return "unmatched";
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
  return "projected";
}
