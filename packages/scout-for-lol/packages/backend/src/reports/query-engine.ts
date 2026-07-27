import type { DiscordGuildId, ReportQueryPlan } from "@scout-for-lol/data";
import {
  CompetitionIdSchema,
  REPORT_MAX_ROWS_LIMIT,
  RankSchema,
  parseAndCompile,
  parseCompetition,
  rankToString,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import {
  scoutReportQueryDurationSeconds,
  scoutReportQueryRunsTotal,
} from "#src/metrics/report-query.ts";
import { runLakeAggregation } from "#src/reports/duckdb/execute.ts";
import {
  cappedLimit,
  rowsFromAggregates,
  sortedAggregates,
} from "#src/reports/query-aggregates.ts";

export type ReportResultValue = {
  column: string;
  value: number | string | null;
};

export type ReportMentionIdentity =
  | {
      kind: "player";
      playerId: number | null;
      alias: string;
      discordId: string | null;
    }
  | {
      kind: "group";
      members: { playerId: number; alias: string }[];
    };

export type ReportResultRow = {
  label: string;
  dimensions: string[];
  mentionIdentity: ReportMentionIdentity | null;
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
  sourceCompetitionId?: number | null;
  now?: Date;
};

/**
 * Execute a ScoutQL report query.
 *
 * Fact-style sources (match_participants, player_groups,
 * prematch_participants, competition_match_participants) run as compiled SQL
 * on embedded DuckDB over the report lake (see reports/duckdb/); rank
 * sources delegate to calculateLeaderboard as before. In all cases the
 * result shape and metric semantics are identical to the legacy fact-table
 * engine — pinned by the parity suite.
 */
export async function executeReportQuery(
  params: ExecuteReportQueryParams,
): Promise<ReportQueryResult> {
  const startedAt = Date.now();
  // Labeled "unknown" until the plan compiles, so a parse failure still
  // records an error datapoint (with an honest source) rather than nothing.
  let source = "unknown";
  try {
    const plan = parseAndCompile(params.queryText);
    source = plan.source;
    const result = await runReportQueryPlan(params, plan);
    recordReportQueryMetrics(source, "success", startedAt);
    return result;
  } catch (error) {
    recordReportQueryMetrics(source, "error", startedAt);
    throw error;
  }
}

async function runReportQueryPlan(
  params: ExecuteReportQueryParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  if (plan.source === "competition_rank" || plan.source === "rank_current") {
    return await executeCompetitionRankReport(params, plan);
  }
  if (plan.source === "competition_match_participants") {
    return await executeCompetitionMatchParticipantReport(params, plan);
  }
  if (
    (plan.source === "player_groups" || plan.source === "player_pairs") &&
    plan.groupBy !== "group"
  ) {
    throw new Error("player_groups reports must GROUP BY group(...).");
  }

  const { startDate, endDate } = lookbackRange(plan, params.now);
  const result = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate,
    endDate,
  });
  return rowsFromAggregates(
    plan,
    sortedAggregates(plan, result.aggregates),
    result.rowsScanned,
    REPORT_MAX_ROWS_LIMIT,
  );
}

function recordReportQueryMetrics(
  source: string,
  outcome: "success" | "error",
  startedAt: number,
): void {
  scoutReportQueryRunsTotal.inc({ source, outcome });
  scoutReportQueryDurationSeconds.observe(
    { source, outcome },
    (Date.now() - startedAt) / 1000,
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
  const { startDate, endDate } = competitionRange(
    competition,
    plan,
    params.now,
  );
  const result = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate,
    endDate,
    playerIds: participantRows.map((row) => row.playerId),
  });
  return rowsFromAggregates(
    plan,
    sortedAggregates(plan, result.aggregates),
    result.rowsScanned,
    REPORT_MAX_ROWS_LIMIT,
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
  const limit = cappedLimit(plan, REPORT_MAX_ROWS_LIMIT);
  const isHighestRankReport = competition.criteria.type === "HIGHEST_RANK";
  const reportColumnForMetric = (metric: string): string =>
    isHighestRankReport && metric === "score" ? "rank" : metric;
  const columns = plan.metrics.map((metric) => reportColumnForMetric(metric));
  return {
    plan,
    columns: ["label", ...columns],
    rows: leaderboard.slice(0, limit).map((entry) => ({
      label: entry.playerName,
      dimensions: [entry.playerName],
      mentionIdentity: {
        kind: "player",
        // Preserve the leaderboard's player id so the live playerDiscordIds map
        // stays authoritative: a player who unlinks between leaderboard
        // calculation and map load falls back to the alias instead of pinging
        // the stale snapshot discordId (same handling as lake-backed reports).
        playerId: entry.playerId,
        alias: entry.playerName,
        discordId: entry.discordId ?? null,
      },
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

function lookbackRange(
  plan: ReportQueryPlan,
  now: Date | undefined,
): {
  startDate: Date;
  endDate: Date;
} {
  const endDate = now ?? new Date();
  return {
    startDate: new Date(
      endDate.getTime() - plan.lookbackDays * 24 * 60 * 60 * 1000,
    ),
    endDate,
  };
}

function competitionRange(
  competition: { startDate: Date | null; endDate: Date | null },
  plan: ReportQueryPlan,
  nowInput: Date | undefined,
): { startDate: Date; endDate: Date } {
  const fallback = lookbackRange(plan, nowInput);
  const now = nowInput ?? new Date();
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
