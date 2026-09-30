import {
  DUEL_DISCLOSURE_VERSION,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  DuelSeriesStatusSchema,
  PlayerIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type {
  ScoutDuelSeriesInput,
  ScoutDuelSeriesRefreshResult,
} from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { duelRolloutAllowed } from "#src/progression/duels/access.ts";
import { duelCompetitorsUseOneRiotRegion } from "#src/progression/duels/competitors.ts";
import {
  duelSeriesOverdue,
  duelSeriesTransitions,
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
  return deadlineAt <= new Date() ? refreshResult(state, deadlineAt) : null;
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
    | "awaiting_acceptance"
    | "awaiting_readiness"
    | "code_ready"
    | "needs_review";
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

async function participantsHaveCurrentConsent(
  guildId: DiscordGuildId,
  participants: readonly {
    readonly playerId: number;
    readonly discordId: string;
  }[],
): Promise<boolean> {
  const playerIds = participants.map((participant) =>
    PlayerIdSchema.parse(participant.playerId),
  );
  const [players, disclosures] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: playerIds }, serverId: guildId },
      select: { id: true, discordId: true },
    }),
    prisma.duelDisclosureAcceptance.findMany({
      where: {
        guildId,
        playerId: { in: playerIds },
        disclosureVersion: DUEL_DISCLOSURE_VERSION,
      },
      select: { playerId: true, discordId: true },
    }),
  ]);
  const currentDiscordIdByPlayer = new Map(
    players.map((player) => [player.id, player.discordId]),
  );
  const disclosureKeys = new Set(
    disclosures.map(
      (disclosure) =>
        `${disclosure.playerId.toString()}:${disclosure.discordId}`,
    ),
  );
  return participants.every(
    (participant) =>
      currentDiscordIdByPlayer.get(
        PlayerIdSchema.parse(participant.playerId),
      ) === participant.discordId &&
      disclosureKeys.has(
        `${participant.playerId.toString()}:${participant.discordId}`,
      ),
  );
}

async function resetStaleParticipantConsent(options: {
  readonly seriesId: string;
  readonly currentState: string;
  readonly deadlineAt: Date;
}): Promise<ScoutDuelSeriesRefreshResult> {
  const reset = await prisma.$transaction(async (tx) => {
    const updated = await tx.duelSeries.updateMany({
      where: { id: options.seriesId, seriesState: options.currentState },
      data: { seriesState: "awaiting_acceptance" },
    });
    if (updated.count === 0) return false;
    await tx.duelSeriesParticipant.updateMany({
      where: { seriesId: options.seriesId },
      data: { acceptedAt: null, readyAt: null },
    });
    return true;
  });
  if (!reset) {
    return await currentRefreshResult(options.seriesId, options.deadlineAt);
  }
  recordTransition(options.currentState, "awaiting_acceptance");
  return refreshResult("awaiting_acceptance", options.deadlineAt);
}

async function readyGameForObservedLobby(options: {
  readonly seriesId: string;
  readonly currentState: string;
  readonly gameNumber: number;
  readonly guildId: string;
  readonly channelId: string;
}): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const transitioned = await tx.duelSeries.updateMany({
      where: { id: options.seriesId, seriesState: options.currentState },
      data: { seriesState: "code_ready" },
    });
    if (transitioned.count === 0) return false;
    const game = await tx.duelGame.upsert({
      where: {
        seriesId_gameNumber: {
          seriesId: options.seriesId,
          gameNumber: options.gameNumber,
        },
      },
      create: {
        seriesId: options.seriesId,
        gameNumber: options.gameNumber,
        gameState: "code_ready",
      },
      update: { gameState: "code_ready", tournamentLobbyId: null },
    });
    await tx.duelStatusOutbox.upsert({
      where: { dedupeKey: `duel-code-ready:${game.id}` },
      create: {
        guildId: options.guildId,
        channelId: DiscordChannelIdSchema.parse(options.channelId),
        dedupeKey: `duel-code-ready:${game.id}`,
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
    !duelCompetitorsUseOneRiotRegion([
      series.competitorOne,
      series.competitorTwo,
    ])
  ) {
    return await transitionSeries({
      seriesId: series.id,
      currentState,
      nextState: "needs_review",
      deadlineAt,
    });
  }
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
  if (
    existingGame !== undefined &&
    ["code_ready", "in_progress"].includes(existingGame.gameState)
  ) {
    return await transitionSeries({
      seriesId: series.id,
      currentState,
      nextState: "code_ready",
      deadlineAt,
    });
  }

  const guildId = DiscordGuildIdSchema.parse(series.guildId);
  if (!(await duelRolloutAllowed(guildId))) {
    return refreshResult("awaiting_readiness", deadlineAt);
  }
  if (!(await participantsHaveCurrentConsent(guildId, series.participants))) {
    return await resetStaleParticipantConsent({
      seriesId: series.id,
      currentState,
      deadlineAt,
    });
  }
  const gameNumber = existingGame?.gameNumber ?? 1;
  const codeReady = await readyGameForObservedLobby({
    seriesId: series.id,
    currentState,
    guildId: series.guildId,
    channelId: series.channelId,
    gameNumber,
  });
  if (!codeReady) return await currentRefreshResult(series.id, deadlineAt);
  recordTransition(currentState, "code_ready");
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
