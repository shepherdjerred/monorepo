import type { ScoutClientObservation } from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";

type ObservedGameState = "PLAYING" | "RESULT_PENDING";

const ResourcePayloadSchema = z.object({ resource: z.string() });
const DataPayloadSchema = z.object({ data: z.unknown() });

function observationResource(payload: unknown): string | null {
  const parsed = ResourcePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.resource : null;
}

function observationData(payload: unknown): unknown {
  const parsed = DataPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.data : payload;
}

/** Map only explicit League lifecycle evidence to a Scout game transition. */
export function observedGameState(
  observation: ScoutClientObservation,
): ObservedGameState | null {
  if (observation.kind === "live_game_frame") return "PLAYING";
  const resource = observationResource(observation.payload);
  if (resource === "post_game" && observation.kind === "post_game") {
    return "RESULT_PENDING";
  }
  if (resource !== "gameflow_phase" || observation.kind !== "gameflow") {
    return null;
  }
  const data = observationData(observation.payload);
  if (data === "InProgress") return "PLAYING";
  if (
    data === "PreEndOfGame" ||
    data === "WaitingForStats" ||
    data === "EndOfGame"
  ) {
    return "RESULT_PENDING";
  }
  return null;
}

function collectPuuids(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPuuids(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      item.length > 0 &&
      (key === "puuid" || key === "summonerPuuid")
    ) {
      into.add(item);
    }
    collectPuuids(item, into);
  }
}

/** Extract the participant identity set from a bounded lobby observation. */
export function lobbyParticipantPuuids(payload: unknown): ReadonlySet<string> {
  const puuids = new Set<string>();
  collectPuuids(payload, puuids);
  return puuids;
}

function sameRoster(
  observed: ReadonlySet<string>,
  expected: readonly { readonly puuid: string }[],
): boolean {
  return (
    observed.size === expected.length &&
    expected.every((participant) => observed.has(participant.puuid))
  );
}

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
      include: { participants: true },
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
  const matchingCustoms = customGames.filter((game) =>
    sameRoster(observed, game.participants),
  );
  const matchingDuels = duelGames.filter((game) =>
    sameRoster(observed, [
      ...game.series.competitorOne.members,
      ...game.series.competitorTwo.members,
    ]),
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

/**
 * Project native gameflow into the already-bound Custom or duel game. The
 * observer identity, not a caller-supplied game id, locates the one active
 * bound game. Ambiguity fails instead of moving either game speculatively.
 */
export async function projectObservedGameState(
  observation: ScoutClientObservation,
): Promise<void> {
  const projection = observedGameState(observation);
  if (projection === null || observation.localPuuid === undefined) return;

  const localPuuid = LeaguePuuidSchema.parse(observation.localPuuid);
  const [customGames, duelGames] = await Promise.all([
    prisma.customGame.findMany({
      where: {
        observedLobbyId: { not: null },
        state: { in: ["LOBBY_READY", "PLAYING", "RESULT_PENDING"] },
        participants: { some: { puuid: localPuuid } },
      },
      include: { night: true },
    }),
    prisma.duelGame.findMany({
      where: {
        observedLobbyId: { not: null },
        gameState: { in: ["code_ready", "in_progress"] },
        series: {
          OR: [
            { competitorOne: { members: { some: { puuid: localPuuid } } } },
            { competitorTwo: { members: { some: { puuid: localPuuid } } } },
          ],
        },
      },
      include: { series: true },
    }),
  ]);
  if (customGames.length + duelGames.length > 1) {
    throw new Error(
      `Observer ${localPuuid} belongs to more than one active bound Scout game`,
    );
  }

  const custom = customGames[0];
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

  const duel = duelGames[0];
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
