import {
  DiscordChannelIdSchema,
  DuelBestOfSchema,
  DuelEventFormatSchema,
  createEliminationFirstRound,
  rankRoundRobin,
} from "@scout-for-lol/data";
import {
  scoutDuelSeriesWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { duelSeriesParticipantsCreateData } from "#src/progression/duels/competitors.ts";
import { launchDuelSeries } from "#src/progression/duels/launch.ts";

type EventWithSeries = NonNullable<
  Awaited<ReturnType<typeof loadEventForAdvancement>>
>;

async function loadEventForAdvancement(
  db: ExtendedPrismaClient,
  eventId: string,
) {
  return await db.duelEvent.findUnique({
    where: { id: eventId },
    include: {
      entrants: {
        where: { registrationState: "accepted" },
        orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
        include: {
          competitor: { include: { members: true } },
        },
      },
      roundOverrides: true,
      series: { include: { games: true } },
    },
  });
}

function seriesBestOf(event: EventWithSeries, roundNumber: number) {
  return DuelBestOfSchema.parse(
    event.roundOverrides.find(
      (override) => override.roundNumber === roundNumber,
    )?.bestOf ?? event.bestOf,
  );
}

async function createSeries(
  db: Db,
  event: EventWithSeries,
  options: {
    readonly firstId: string;
    readonly secondId: string;
    readonly bracket: string;
    readonly roundNumber: number;
    readonly position: number;
    readonly stage: ScoutStage;
  },
) {
  const first = event.entrants.find(
    (entrant) => entrant.competitorId === options.firstId,
  );
  const second = event.entrants.find(
    (entrant) => entrant.competitorId === options.secondId,
  );
  if (first === undefined || second === undefined) {
    throw new Error("An advancing competitor is not registered in the event");
  }
  const deadlineAt = new Date(
    Date.now() + event.matchWindowHours * 60 * 60 * 1000,
  );
  const existing = await db.duelSeries.findUnique({
    where: {
      eventId_bracket_roundNumber_position: {
        eventId: event.id,
        bracket: options.bracket,
        roundNumber: options.roundNumber,
        position: options.position,
      },
    },
  });
  if (existing !== null) {
    if (
      existing.competitorOneId !== options.firstId ||
      existing.competitorTwoId !== options.secondId
    ) {
      throw new Error(
        "An event bracket slot was reused with different competitors",
      );
    }
    return {
      seriesId: existing.id,
      deadlineAt: existing.deadlineAt ?? deadlineAt,
    };
  }
  const seriesId = crypto.randomUUID();
  const series = await db.duelSeries.create({
    data: {
      id: seriesId,
      guildId: event.guildId,
      eventId: event.id,
      roundNumber: options.roundNumber,
      bracket: options.bracket,
      position: options.position,
      competitorOneId: options.firstId,
      competitorTwoId: options.secondId,
      bestOf: seriesBestOf(event, options.roundNumber),
      matchWindowHours: event.matchWindowHours,
      rulesetJson: event.rulesetJson,
      seriesState: "awaiting_readiness",
      channelId: DiscordChannelIdSchema.parse(event.channelId),
      organizerDiscordId: event.organizerDiscordId,
      windowStartsAt: new Date(),
      deadlineAt,
      workflowId: scoutDuelSeriesWorkflowId(options.stage, seriesId),
      participants: {
        create: duelSeriesParticipantsCreateData([first, second]),
      },
    },
  });
  return { seriesId: series.id, deadlineAt };
}

async function createSeriesRound(
  db: ExtendedPrismaClient,
  event: EventWithSeries,
  options: {
    readonly pairs: readonly [string, string][];
    readonly bracket: string;
    readonly roundNumber: number;
    readonly stage: ScoutStage;
  },
) {
  return await db.$transaction(async (tx) => {
    // A whole round is one durable unit. This lock also makes the read-then-
    // create idempotency check safe when reconciliation runs concurrently.
    await tx.$executeRaw`SELECT 1 FROM "DuelEvent" WHERE "id" = ${event.id} FOR UPDATE`;
    const requests: Awaited<ReturnType<typeof createSeries>>[] = [];
    for (const [firstId, secondId] of options.pairs) {
      requests.push(
        await createSeries(tx, event, {
          firstId,
          secondId,
          bracket: options.bracket,
          roundNumber: options.roundNumber,
          position: requests.length,
          stage: options.stage,
        }),
      );
    }
    return requests;
  });
}

function completedRound(event: EventWithSeries, roundNumber: number): boolean {
  const series = event.series.filter(
    (candidate) => candidate.roundNumber === roundNumber,
  );
  return (
    series.length > 0 &&
    series.every(
      (candidate) =>
        candidate.seriesState === "completed" &&
        candidate.winnerCompetitorId !== null,
    )
  );
}

function lossCounts(event: EventWithSeries): Map<string, number> {
  const losses = new Map(
    event.entrants.map((entrant) => [entrant.competitorId, 0]),
  );
  for (const series of event.series) {
    if (
      series.seriesState !== "completed" ||
      series.winnerCompetitorId === null
    ) {
      continue;
    }
    const loser =
      series.winnerCompetitorId === series.competitorOneId
        ? series.competitorTwoId
        : series.competitorOneId;
    losses.set(loser, (losses.get(loser) ?? 0) + 1);
  }
  return losses;
}

function pairAdjacent(ids: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let index = 0; index + 1 < ids.length; index += 2) {
    const first = ids[index];
    const second = ids[index + 1];
    if (first !== undefined && second !== undefined)
      pairs.push([first, second]);
  }
  return pairs;
}

function everyPair(ids: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < ids.length;
      secondIndex += 1
    ) {
      const first = ids[firstIndex];
      const second = ids[secondIndex];
      if (first !== undefined && second !== undefined) {
        pairs.push([first, second]);
      }
    }
  }
  return pairs;
}

async function advanceDoubleElimination(
  db: ExtendedPrismaClient,
  event: EventWithSeries,
  stage: ScoutStage,
) {
  const latestRound = Math.max(
    1,
    ...event.series.map((series) => series.roundNumber ?? 1),
  );
  if (!completedRound(event, latestRound)) return [];
  const losses = lossCounts(event);
  const active = event.entrants
    .map((entrant) => entrant.competitorId)
    .filter((competitorId) => (losses.get(competitorId) ?? 0) < 2);
  if (active.length === 1) {
    await db.duelEvent.update({
      where: { id: event.id },
      data: { eventState: "completed", completedAt: new Date() },
    });
    return [];
  }
  const nextRound = latestRound + 1;
  const zeroLoss = active.filter((id) => (losses.get(id) ?? 0) === 0);
  const oneLoss = active.filter((id) => (losses.get(id) ?? 0) === 1);
  let pairs: [string, string][];
  let bracket: string;
  if (active.length === 2 && zeroLoss.length === 1 && oneLoss.length === 1) {
    const winnersFinalist = zeroLoss[0];
    const losersFinalist = oneLoss[0];
    if (winnersFinalist === undefined || losersFinalist === undefined) {
      throw new Error("A double-elimination final requires two finalists");
    }
    pairs = [[winnersFinalist, losersFinalist]];
    bracket = "grand_final";
  } else if (
    active.length === 2 &&
    zeroLoss.length === 0 &&
    oneLoss.length === 2
  ) {
    const firstFinalist = oneLoss[0];
    const secondFinalist = oneLoss[1];
    if (firstFinalist === undefined || secondFinalist === undefined) {
      throw new Error("A grand-final reset requires two finalists");
    }
    pairs = [[firstFinalist, secondFinalist]];
    bracket = "grand_final_reset";
  } else {
    pairs = [...pairAdjacent(zeroLoss), ...pairAdjacent(oneLoss)];
    bracket = "double_elimination";
  }
  return await createSeriesRound(db, event, {
    pairs,
    bracket,
    roundNumber: nextRound,
    stage,
  });
}

function singleEliminationRoundWinners(
  event: EventWithSeries,
  roundNumber: number,
): (string | null)[] {
  if (roundNumber === 1) {
    const initial = createEliminationFirstRound(
      event.entrants.map((entrant) => entrant.competitorId),
    );
    return initial.map((pairing) => {
      if (pairing.byeWinnerEntrantId !== null) {
        return pairing.byeWinnerEntrantId;
      }
      return (
        event.series.find(
          (series) =>
            series.bracket === "winners" &&
            series.roundNumber === 1 &&
            series.position === pairing.position &&
            series.seriesState === "completed",
        )?.winnerCompetitorId ?? null
      );
    });
  }
  return event.series
    .filter(
      (series) =>
        series.bracket === "winners" && series.roundNumber === roundNumber,
    )
    .toSorted((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((series) =>
      series.seriesState === "completed" ? series.winnerCompetitorId : null,
    );
}

async function advanceSingleElimination(
  db: ExtendedPrismaClient,
  event: EventWithSeries,
  stage: ScoutStage,
) {
  const currentRound = Math.max(
    1,
    ...event.series
      .filter((series) => series.bracket === "winners")
      .map((series) => series.roundNumber ?? 1),
  );
  const winners = singleEliminationRoundWinners(event, currentRound);
  if (winners.length === 0 || winners.includes(null)) {
    return [];
  }
  const resolvedWinners = winners.flatMap((winner) =>
    winner === null ? [] : [winner],
  );
  if (resolvedWinners.length === 1) {
    await db.duelEvent.update({
      where: { id: event.id },
      data: { eventState: "completed", completedAt: new Date() },
    });
    return [];
  }
  const nextRound = currentRound + 1;
  return await createSeriesRound(db, event, {
    pairs: pairAdjacent(resolvedWinners),
    bracket: "winners",
    roundNumber: nextRound,
    stage,
  });
}

async function advanceRoundRobin(
  db: ExtendedPrismaClient,
  event: EventWithSeries,
  stage: ScoutStage,
) {
  if (
    event.series.some(
      (series) =>
        series.seriesState !== "completed" ||
        series.winnerCompetitorId === null,
    )
  ) {
    return [];
  }
  const results = event.series.map((series) => ({
    firstCompetitorId: series.competitorOneId,
    secondCompetitorId: series.competitorTwoId,
    winnerCompetitorId: series.winnerCompetitorId ?? "",
    firstGameWins: series.games.filter(
      (game) => game.winnerCompetitorId === series.competitorOneId,
    ).length,
    secondGameWins: series.games.filter(
      (game) => game.winnerCompetitorId === series.competitorTwoId,
    ).length,
  }));
  const ranks = rankRoundRobin(
    event.entrants.map((entrant) => entrant.competitorId),
    results,
  );
  const tied = ranks.filter((rank) => rank.needsTiebreak);
  if (tied.length === 0) {
    await db.duelEvent.update({
      where: { id: event.id },
      data: { eventState: "completed", completedAt: new Date() },
    });
    return [];
  }
  const nextRound =
    Math.max(1, ...event.series.map((series) => series.roundNumber ?? 1)) + 1;
  const tiedGroups = Map.groupBy(
    tied,
    (rank) =>
      `${rank.seriesWins.toString()}:${rank.gameDifferential.toString()}`,
  );
  const pairs = [...tiedGroups.values()].flatMap((group) =>
    everyPair(group.map((rank) => rank.competitorId)),
  );
  return await createSeriesRound(db, event, {
    pairs,
    bracket: "tiebreak",
    roundNumber: nextRound,
    stage,
  });
}

export async function advanceDuelEvent(
  eventId: string,
  stage: ScoutStage,
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  const event = await loadEventForAdvancement(db, eventId);
  if (event?.eventState !== "in_progress") return;
  const format = DuelEventFormatSchema.parse(event.format);
  const requests =
    format === "single_elimination"
      ? await advanceSingleElimination(db, event, stage)
      : format === "double_elimination"
        ? await advanceDoubleElimination(db, event, stage)
        : format === "round_robin"
          ? await advanceRoundRobin(db, event, stage)
          : [];
  await Promise.all(
    requests.map((request) => launchDuelSeries({ stage, ...request })),
  );
}
