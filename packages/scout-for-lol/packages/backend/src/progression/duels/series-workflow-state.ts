import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  DuelSeriesStatusSchema,
  RegionSchema,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import type {
  ScoutDuelSeriesInput,
  ScoutDuelSeriesRefreshResult,
} from "@scout-for-lol/temporal";
import { tournamentApiMode } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { provisionTournamentLobby } from "#src/league/tournament/provision-lobby.ts";
import { duelRolloutAllowed } from "#src/progression/duels/access.ts";
import {
  duelResults,
  duelSeriesOverdue,
  duelSeriesTransitions,
  duelTournamentProvisioning,
} from "#src/metrics/progression.ts";

const TERMINAL_STATES = new Set([
  "overdue",
  "needs_review",
  "completed",
  "no_contest",
  "cancelled",
]);

function recordTransition(from: string, to: string): void {
  if (from !== to) duelSeriesTransitions.inc({ from, to });
}

function refreshResult(
  state: string,
  deadlineAt: Date,
): ScoutDuelSeriesRefreshResult {
  const seriesState = DuelSeriesStatusSchema.parse(state);
  return {
    terminal: TERMINAL_STATES.has(seriesState),
    status: seriesState,
    deadlineAt: deadlineAt.toISOString(),
  };
}

function closedSeriesResult(
  state: string,
  deadlineAt: Date,
): ScoutDuelSeriesRefreshResult | null {
  if (TERMINAL_STATES.has(state)) return refreshResult(state, deadlineAt);
  if (deadlineAt <= new Date()) return refreshResult(state, deadlineAt);
  return null;
}

async function currentRefreshResult(
  seriesId: string,
  fallbackDeadlineAt: Date,
): Promise<ScoutDuelSeriesRefreshResult> {
  const current = await prisma.duelSeries.findUniqueOrThrow({
    where: { id: seriesId },
    select: { seriesState: true, deadlineAt: true },
  });
  return refreshResult(
    current.seriesState,
    current.deadlineAt ?? fallbackDeadlineAt,
  );
}

async function transitionSeries(options: {
  readonly seriesId: string;
  readonly currentState: string;
  readonly nextState:
    "awaiting_acceptance" | "awaiting_readiness" | "code_ready";
  readonly deadlineAt: Date;
  readonly windowStartsAt?: Date | null;
}): Promise<ScoutDuelSeriesRefreshResult> {
  if (options.currentState === options.nextState) {
    return refreshResult(options.nextState, options.deadlineAt);
  }
  const updated = await prisma.duelSeries.updateMany({
    where: { id: options.seriesId, seriesState: options.currentState },
    data: {
      seriesState: options.nextState,
      ...(options.nextState === "awaiting_readiness"
        ? {
            windowStartsAt: options.windowStartsAt ?? new Date(),
            deadlineAt: options.deadlineAt,
          }
        : {}),
    },
  });
  if (updated.count === 0) {
    return await currentRefreshResult(options.seriesId, options.deadlineAt);
  }
  recordTransition(options.currentState, options.nextState);
  return refreshResult(options.nextState, options.deadlineAt);
}

async function claimGameProvisioning(options: {
  readonly seriesId: string;
  readonly currentState: string;
  readonly gameNumber: number;
}) {
  return await prisma.$transaction(async (tx) => {
    const transitioned = await tx.duelSeries.updateMany({
      where: { id: options.seriesId, seriesState: options.currentState },
      data: { seriesState: "provisioning_code" },
    });
    if (transitioned.count === 0) return null;
    return await tx.duelGame.upsert({
      where: {
        seriesId_gameNumber: {
          seriesId: options.seriesId,
          gameNumber: options.gameNumber,
        },
      },
      create: {
        seriesId: options.seriesId,
        gameNumber: options.gameNumber,
        gameState: "provisioning_code",
      },
      update: { gameState: "provisioning_code" },
    });
  });
}

async function markRegionReview(options: {
  readonly seriesId: string;
  readonly gameId: string;
  readonly deadlineAt: Date;
}): Promise<ScoutDuelSeriesRefreshResult> {
  const transitioned = await prisma.$transaction(async (tx) => {
    const updatedSeries = await tx.duelSeries.updateMany({
      where: { id: options.seriesId, seriesState: "provisioning_code" },
      data: { seriesState: "needs_review" },
    });
    if (updatedSeries.count === 0) return false;
    const updatedGame = await tx.duelGame.updateMany({
      where: { id: options.gameId, gameState: "provisioning_code" },
      data: {
        gameState: "needs_review",
        resultState: "needs_review",
        reviewReason: "Duel competitors must use accounts in one Riot region",
      },
    });
    if (updatedGame.count !== 1) {
      throw new Error("A provisioning duel game changed state unexpectedly");
    }
    return true;
  });
  if (!transitioned) {
    return await currentRefreshResult(options.seriesId, options.deadlineAt);
  }
  duelResults.inc({ status: "needs_review" });
  recordTransition("provisioning_code", "needs_review");
  return refreshResult("needs_review", options.deadlineAt);
}

async function finishCodeProvisioning(options: {
  readonly seriesId: string;
  readonly gameId: string;
  readonly guildId: string;
  readonly channelId: DiscordChannelId;
  readonly gameNumber: number;
  readonly lobbyId: number;
}): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const transitioned = await tx.duelSeries.updateMany({
      where: { id: options.seriesId, seriesState: "provisioning_code" },
      data: { seriesState: "code_ready" },
    });
    if (transitioned.count === 0) return false;
    const updatedGame = await tx.duelGame.updateMany({
      where: { id: options.gameId, gameState: "provisioning_code" },
      data: { tournamentLobbyId: options.lobbyId, gameState: "code_ready" },
    });
    if (updatedGame.count !== 1) {
      throw new Error("A provisioned duel game changed state unexpectedly");
    }
    await tx.duelStatusOutbox.upsert({
      where: { dedupeKey: `duel-code-ready:${options.gameId}` },
      create: {
        guildId: options.guildId,
        channelId: options.channelId,
        dedupeKey: `duel-code-ready:${options.gameId}`,
        payloadJson: JSON.stringify({
          kind: "code_ready",
          seriesId: options.seriesId,
          gameNumber: options.gameNumber,
        }),
      },
      update: {},
    });
    return true;
  });
}

export async function refreshDuelSeriesWorkflowState(
  input: ScoutDuelSeriesInput,
): Promise<ScoutDuelSeriesRefreshResult> {
  const series = await prisma.duelSeries.findUniqueOrThrow({
    where: { id: input.seriesId },
    include: {
      participants: true,
      games: { orderBy: { gameNumber: "desc" }, take: 1 },
      competitorOne: { include: { members: true } },
      competitorTwo: { include: { members: true } },
    },
  });
  const deadlineAt = series.deadlineAt ?? new Date(input.deadlineAt);
  const currentState = DuelSeriesStatusSchema.parse(series.seriesState);
  const closed = closedSeriesResult(currentState, deadlineAt);
  if (closed !== null) return closed;
  if (
    series.participants.some((participant) => participant.acceptedAt === null)
  ) {
    return await transitionSeries({
      seriesId: series.id,
      currentState,
      nextState: "awaiting_acceptance",
      deadlineAt,
    });
  }
  if (series.participants.some((participant) => participant.readyAt === null)) {
    return await transitionSeries({
      seriesId: series.id,
      currentState,
      nextState: "awaiting_readiness",
      deadlineAt,
      windowStartsAt: series.windowStartsAt,
    });
  }

  const existingGame = series.games[0];
  if (existingGame !== undefined && existingGame.tournamentLobbyId !== null) {
    return await transitionSeries({
      seriesId: series.id,
      currentState,
      nextState: "code_ready",
      deadlineAt,
    });
  }

  const guildId = DiscordGuildIdSchema.parse(series.guildId);
  if (!(await duelRolloutAllowed(prisma, guildId, input.stage))) {
    return refreshResult("awaiting_readiness", deadlineAt);
  }
  const gameNumber = existingGame?.gameNumber ?? 1;
  const game = await claimGameProvisioning({
    seriesId: series.id,
    currentState,
    gameNumber,
  });
  if (game === null) {
    return await currentRefreshResult(series.id, deadlineAt);
  }
  recordTransition(currentState, "provisioning_code");
  const firstMembers = series.competitorOne.members.toSorted(
    (left, right) => left.position - right.position,
  );
  const secondMembers = series.competitorTwo.members.toSorted(
    (left, right) => left.position - right.position,
  );
  const regions = new Set(
    [...firstMembers, ...secondMembers].map((member) => member.region),
  );
  if (regions.size !== 1) {
    return await markRegionReview({
      seriesId: series.id,
      gameId: game.id,
      deadlineAt,
    });
  }
  const regionValue = [...regions][0];
  if (regionValue === undefined) {
    throw new Error("A ready duel series has no frozen Riot accounts");
  }
  let lobby;
  try {
    lobby = await provisionTournamentLobby(prisma, {
      kind: "declared",
      requestId: `duel:${series.id}:game:${gameNumber.toString()}`,
      mode: tournamentApiMode(),
      serverId: guildId,
      channelId: DiscordChannelIdSchema.parse(series.channelId),
      creatorDiscordId: DiscordAccountIdSchema.parse(series.organizerDiscordId),
      blue: {
        aliases: firstMembers.map((member) => member.playerAlias),
        puuids: firstMembers.map((member) => member.puuid),
        region: RegionSchema.parse(regionValue),
      },
      red: {
        aliases: secondMembers.map((member) => member.playerAlias),
        puuids: secondMembers.map((member) => member.puuid),
        region: RegionSchema.parse(regionValue),
      },
      pickType: "TOURNAMENT_DRAFT",
      mapType: "SUMMONERS_RIFT",
      spectatorType: "ALL",
      lobbyName: `Scout duel ${series.id.slice(0, 8)}`,
    });
    duelTournamentProvisioning.inc({ status: "ready" });
  } catch (error) {
    duelTournamentProvisioning.inc({ status: "failed" });
    throw error;
  }
  const codeReady = await finishCodeProvisioning({
    seriesId: series.id,
    gameId: game.id,
    guildId: series.guildId,
    channelId: series.channelId,
    gameNumber,
    lobbyId: lobby.id,
  });
  if (!codeReady) return await currentRefreshResult(series.id, deadlineAt);
  recordTransition("provisioning_code", "code_ready");
  return refreshResult("code_ready", deadlineAt);
}

export async function markDuelSeriesOverdue(
  input: ScoutDuelSeriesInput,
): Promise<void> {
  const now = new Date();
  const transitioned = await prisma.$transaction(async (tx) => {
    const series = await tx.duelSeries.findUniqueOrThrow({
      where: { id: input.seriesId },
      include: { participants: true },
    });
    const currentState = DuelSeriesStatusSchema.parse(series.seriesState);
    if (TERMINAL_STATES.has(currentState)) return null;
    const deadlineAt = series.deadlineAt ?? new Date(input.deadlineAt);
    if (deadlineAt > now) return null;
    const updated = await tx.duelSeries.updateMany({
      where: {
        id: series.id,
        seriesState: { notIn: [...TERMINAL_STATES] },
        OR: [{ deadlineAt: null }, { deadlineAt: { lte: now } }],
      },
      data: { seriesState: "overdue" },
    });
    if (updated.count === 0) return null;
    await tx.duelStatusOutbox.upsert({
      where: { dedupeKey: `duel-overdue:${series.id}` },
      create: {
        guildId: series.guildId,
        channelId: series.channelId,
        dedupeKey: `duel-overdue:${series.id}`,
        payloadJson: JSON.stringify({
          kind: "overdue",
          seriesId: series.id,
          mentionDiscordIds: series.participants.map(
            (participant) => participant.discordId,
          ),
        }),
      },
      update: {},
    });
    return currentState;
  });
  if (transitioned !== null) {
    recordTransition(transitioned, "overdue");
    duelSeriesOverdue.inc();
  }
}
