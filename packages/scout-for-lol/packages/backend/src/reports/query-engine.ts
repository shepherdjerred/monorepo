import type { DiscordGuildId } from "@scout-for-lol/data";
import {
  CompetitionIdSchema,
  RankSchema,
  parseCompetition,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import {
  aggregateMatchFacts,
  aggregatePairFacts,
  aggregatePrematchFacts,
  cappedLimit,
  rowsFromAggregates,
  type MatchParticipantFactRow,
} from "#src/reports/query-aggregates.ts";
import {
  parseReportQuery,
  type ReportQueryPlan,
} from "#src/reports/query-language.ts";

export type ReportResultValue = {
  column: string;
  value: number | string;
};

export type ReportResultRow = {
  label: string;
  discordId: string | null;
  values: ReportResultValue[];
};

export type ReportQueryResult = {
  plan: ReportQueryPlan;
  columns: string[];
  rows: ReportResultRow[];
  rowsScanned: number;
};

type ExecuteReportQueryParams = {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  sourceCompetitionId?: number | null;
  now?: Date;
};

export async function executeReportQuery(
  params: ExecuteReportQueryParams,
): Promise<ReportQueryResult> {
  const plan = parseReportQuery(params.queryText);

  if (plan.source === "competition_rank" || plan.source === "rank_current") {
    return await executeCompetitionRankReport(params, plan);
  }
  if (plan.source === "prematch_participants") {
    return await executePrematchParticipantReport(params, plan);
  }
  if (plan.source === "player_pairs") {
    return await executePlayerPairsReport(params, plan);
  }
  if (plan.source === "competition_match_participants") {
    return await executeCompetitionMatchParticipantReport(params, plan);
  }
  return await executeMatchParticipantReport(params, plan);
}

async function executeMatchParticipantReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const { startDate, endDate } = lookbackRange(params);
  const facts = await fetchMatchParticipantFacts({
    ...params,
    plan,
    startDate,
    endDate,
  });
  return rowsFromAggregates(
    plan,
    aggregateMatchFacts(facts, plan),
    facts.length,
    params.maxRows,
  );
}

async function executeCompetitionMatchParticipantReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const competitionId = resolveCompetitionId(params, plan);
  const competition = parseCompetition(
    await params.prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== params.serverId) {
    throw new Error("Report competition does not belong to this server.");
  }

  const participantRows = await params.prisma.competitionParticipant.findMany({
    where: {
      competitionId: CompetitionIdSchema.parse(competitionId),
      joinedAt: { not: null },
    },
    select: { playerId: true },
  });
  const { startDate, endDate } = competitionRange(competition, params);
  const facts = await fetchMatchParticipantFacts({
    ...params,
    plan,
    startDate,
    endDate,
    playerIds: participantRows.map((row) => row.playerId),
  });
  return rowsFromAggregates(
    plan,
    aggregateMatchFacts(facts, plan),
    facts.length,
    params.maxRows,
  );
}

async function executePrematchParticipantReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const { startDate, endDate } = lookbackRange(params);
  const facts = await params.prisma.prematchParticipantFact.findMany({
    where: {
      serverId: params.serverId,
      ...(plan.queueFilter === undefined
        ? {}
        : { queue: { in: plan.queueFilter } }),
      observedAt: { gte: startDate, lte: endDate },
    },
  });
  const filtered =
    plan.championId === undefined
      ? facts
      : facts.filter((fact) => fact.championId === plan.championId);
  return rowsFromAggregates(
    plan,
    aggregatePrematchFacts(filtered, plan),
    facts.length,
    params.maxRows,
  );
}

async function executePlayerPairsReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  if (plan.groupBy !== "pair") {
    throw new Error("player_pairs reports must GROUP BY pair.");
  }

  const { startDate, endDate } = lookbackRange(params);
  const facts = await fetchMatchParticipantFacts({
    ...params,
    plan,
    startDate,
    endDate,
  });
  return rowsFromAggregates(
    plan,
    aggregatePairFacts(facts, plan),
    facts.length,
    params.maxRows,
  );
}

async function executeCompetitionRankReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const competitionId = resolveCompetitionId(params, plan);
  const competition = parseCompetition(
    await params.prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== params.serverId) {
    throw new Error("Report competition does not belong to this server.");
  }

  const leaderboard = await calculateLeaderboard(params.prisma, competition);
  const limit = cappedLimit(plan, params.maxRows);
  return {
    plan,
    columns: ["label", ...plan.metrics],
    rows: leaderboard.slice(0, limit).map((entry) => ({
      label: entry.playerName,
      discordId: entry.discordId ?? null,
      values: plan.metrics.map((metric) => ({
        column: metric,
        value: metric === "score" ? scoreToNumber(entry.score) : entry.rank,
      })),
    })),
    rowsScanned: leaderboard.length,
  };
}

async function fetchMatchParticipantFacts(params: {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  plan: ReportQueryPlan;
  startDate: Date;
  endDate: Date;
  playerIds?: number[];
}): Promise<MatchParticipantFactRow[]> {
  const facts = await params.prisma.matchParticipantFact.findMany({
    where: {
      serverId: params.serverId,
      ...(params.plan.queueFilter === undefined
        ? {}
        : { queue: { in: params.plan.queueFilter } }),
      ...(params.playerIds === undefined
        ? {}
        : { playerId: { in: params.playerIds } }),
      gameCreationAt: { gte: params.startDate, lte: params.endDate },
    },
  });

  if (params.plan.championId === undefined) {
    return facts;
  }
  return facts.filter((fact) => fact.championId === params.plan.championId);
}

function lookbackRange(params: ExecuteReportQueryParams): {
  startDate: Date;
  endDate: Date;
} {
  const endDate = params.now ?? new Date();
  return {
    startDate: new Date(
      endDate.getTime() - params.lookbackDays * 24 * 60 * 60 * 1000,
    ),
    endDate,
  };
}

function competitionRange(
  competition: { startDate: Date | null; endDate: Date | null },
  params: ExecuteReportQueryParams,
): { startDate: Date; endDate: Date } {
  const fallback = lookbackRange(params);
  const now = params.now ?? new Date();
  const configuredEnd = competition.endDate ?? now;
  return {
    startDate: competition.startDate ?? fallback.startDate,
    endDate: new Date(Math.min(configuredEnd.getTime(), now.getTime())),
  };
}

function resolveCompetitionId(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): number {
  const sourceCompetitionId = params.sourceCompetitionId ?? undefined;
  const competitionId = plan.competitionId ?? sourceCompetitionId;
  if (competitionId === undefined) {
    throw new Error("Competition-backed reports require a competition_id.");
  }
  if (
    plan.competitionId !== undefined &&
    sourceCompetitionId !== undefined &&
    plan.competitionId !== sourceCompetitionId
  ) {
    throw new Error("Report competition_id does not match its source.");
  }
  return competitionId;
}

function scoreToNumber(score: unknown): number {
  const rankResult = RankSchema.safeParse(score);
  if (rankResult.success) {
    return rankToLeaguePoints(rankResult.data);
  }
  return typeof score === "number" ? score : 0;
}
