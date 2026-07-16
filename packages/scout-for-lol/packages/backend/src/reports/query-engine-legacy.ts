/**
 * LEGACY fact-table report engine — kept ONLY for the parity test suite
 * (query-engine-parity.integration.test.ts) during the lake migration.
 * DELETE this file together with the fact tables in the follow-up PR.
 */
import type { DiscordGuildId, ReportQueryPlan } from "@scout-for-lol/data";
import {
  CompetitionIdSchema,
  RankSchema,
  parseAndCompile,
  parseCompetition,
  rankToString,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import {
  aggregateMatchFacts,
  aggregatePrematchFacts,
  cappedLimit,
  rowsFromAggregates,
  sortedAggregates,
  type MatchParticipantFactRow,
} from "#src/reports/query-aggregates.ts";
import {
  aggregateGroupFacts,
  type GroupFactRow,
} from "#src/reports/group-combinations.ts";
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

export async function executeReportQueryLegacy(
  params: ExecuteReportQueryParams,
): Promise<ReportQueryResult> {
  const plan = parseAndCompile(params.queryText);

  if (plan.source === "competition_rank" || plan.source === "rank_current") {
    return await executeCompetitionRankReport(params, plan);
  }
  if (plan.source === "prematch_participants") {
    return await executePrematchParticipantReport(params, plan);
  }
  if (plan.source === "player_groups" || plan.source === "player_pairs") {
    return await executePlayerGroupsReport(params, plan);
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

// The SQLite fact table has no playerSubteamId column, but it archives the
// raw participant JSON — pick just the subteam id out of it for Arena group
// scoping (null / absent for every non-Arena queue).
const RawSubteamSchema = z.object({
  playerSubteamId: z.number().int().nullish(),
});

async function executePlayerGroupsReport(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  if (plan.groupBy !== "group" || plan.groupSize === undefined) {
    throw new Error("player_groups reports must GROUP BY group(...).");
  }

  const { startDate, endDate } = lookbackRange(params);
  const facts = await fetchMatchParticipantFacts({
    ...params,
    plan,
    startDate,
    endDate,
  });
  const groupFacts = facts.map((fact) => toGroupFactRow(fact));
  return rowsFromAggregates(
    plan,
    sortedAggregates(plan, aggregateGroupFacts(groupFacts, plan.groupSize)),
    facts.length,
    params.maxRows,
  );
}

function toGroupFactRow(fact: MatchParticipantFactRow): GroupFactRow {
  const raw =
    fact.rawParticipantJson === undefined
      ? {}
      : RawSubteamSchema.parse(JSON.parse(fact.rawParticipantJson));
  return {
    playerId: fact.playerId,
    playerAlias: fact.playerAlias,
    matchId: fact.matchId,
    teamId: fact.teamId,
    playerSubteamId: raw.playerSubteamId ?? null,
    win: fact.win,
    surrendered: fact.surrendered,
    kills: fact.kills,
    deaths: fact.deaths,
    assists: fact.assists,
    creepScore: fact.creepScore,
    damageToChampions: fact.damageToChampions,
    // The legacy fact table has no source columns for the lake-only
    // counters; they read 0, matching the pre-lake pair engine.
    goldEarned: 0,
    visionScore: 0,
    damageTaken: 0,
    totalDamageDealt: 0,
    wardsPlaced: 0,
    multikills: 0,
    gameDurationSeconds: 0,
    timePlayedSeconds: 0,
  };
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
  const isHighestRankReport = competition.criteria.type === "HIGHEST_RANK";
  const reportColumnForMetric = (metric: string): string =>
    isHighestRankReport && metric === "score" ? "rank" : metric;
  const columns = plan.metrics.map((metric) => reportColumnForMetric(metric));
  return {
    plan,
    columns: ["label", ...columns],
    rows: leaderboard.slice(0, limit).map((entry) => ({
      label: entry.playerName,
      discordId: entry.discordId ?? null,
      values: plan.metrics.map((metric) => {
        const column = reportColumnForMetric(metric);
        return {
          column,
          value:
            column === "rank"
              ? rankToString(RankSchema.parse(entry.score))
              : metric === "score"
                ? scoreToNumber(entry.score)
                : entry.rank,
        };
      }),
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
