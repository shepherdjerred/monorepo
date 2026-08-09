import type { DiscordGuildId, ReportQueryPlan } from "@scout-for-lol/data";
import {
  CompetitionIdSchema,
  REPORT_MAX_ROWS_LIMIT,
  RankSchema,
  comparisonDeltas,
  type VisualizationSnapshot,
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
import {
  clampTemporalRange,
  resolveTemporalRanges,
  type TemporalRange,
} from "#src/reports/temporal-range.ts";
import { buildVisualizationSnapshot } from "#src/reports/visualization-snapshot.ts";

export type ReportResultValue = {
  column: string;
  value: number | string | null;
  comparisonValue?: number | string | null;
  absoluteDelta?: number | null;
  percentageDelta?: number | null;
  sampleSize?: number;
  successes?: number;
  confidenceInterval?: {
    level: 0.95;
    lower: number;
    upper: number;
  } | null;
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
  comparisonRows?: ReportResultRow[];
  visualization?: VisualizationSnapshot;
  evidence?: {
    label: string;
    values: {
      column: string;
      sampleSize: number;
      successes?: number;
      confidenceInterval?: {
        level: 0.95;
        lower: number;
        upper: number;
      } | null;
    }[];
  }[];
};

export type ExecuteReportQueryParams = {
  prisma: ExtendedPrismaClient;
  serverId: DiscordGuildId;
  queryText: string;
  sourceCompetitionId?: number | null;
  now?: Date;
  onPlan?: ((plan: ReportQueryPlan) => void) | undefined;
  rangeOverride?: TemporalRange;
};
type ReportExecutionParams = Omit<
  ExecuteReportQueryParams,
  "queryText" | "onPlan"
>;

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
    params.onPlan?.(plan);
    const result = await runReportQueryPlan(params, plan);
    const visualization = buildVisualizationSnapshot(
      result,
      params.now ?? new Date(),
    );
    recordReportQueryMetrics(source, "success", startedAt);
    return { ...result, visualization };
  } catch (error) {
    recordReportQueryMetrics(source, "error", startedAt);
    throw error;
  }
}

export async function executeCompiledReportQuery(
  params: Omit<ExecuteReportQueryParams, "queryText" | "onPlan">,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const result = await runReportQueryPlan(params, plan);
  return {
    ...result,
    visualization: buildVisualizationSnapshot(result, params.now ?? new Date()),
  };
}

async function runReportQueryPlan(
  params: ReportExecutionParams,
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

  const ranges = queryRanges(plan, params.now, params.rangeOverride);
  const result = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate: ranges.current.startDate,
    endDate: ranges.current.endDate,
  });
  const current = rowsFromAggregates(
    plan,
    sortedAggregates(plan, result.aggregates),
    result.rowsScanned,
    plan.analysis === undefined ? REPORT_MAX_ROWS_LIMIT : 2000,
  );
  if (ranges.comparison === null) return current;
  const comparison = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate: ranges.comparison.startDate,
    endDate: ranges.comparison.endDate,
  });
  return {
    ...current,
    rowsScanned: current.rowsScanned + comparison.rowsScanned,
    ...attachComparison(
      current.rows,
      rowsFromAggregates(
        plan,
        sortedAggregates(plan, comparison.aggregates),
        comparison.rowsScanned,
        2000,
      ).rows,
    ),
  };
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
  params: ReportExecutionParams,
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
  const ranges = competitionQueryRanges(
    competition,
    plan,
    params.now,
    params.rangeOverride,
  );
  const result = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate: ranges.current.startDate,
    endDate: ranges.current.endDate,
    playerIds: participantRows.map((row) => row.playerId),
  });
  const current = rowsFromAggregates(
    plan,
    sortedAggregates(plan, result.aggregates),
    result.rowsScanned,
    plan.analysis === undefined ? REPORT_MAX_ROWS_LIMIT : 2000,
  );
  if (ranges.comparison === null) return current;
  const comparison = await runLakeAggregation({
    plan,
    serverId: params.serverId,
    startDate: ranges.comparison.startDate,
    endDate: ranges.comparison.endDate,
    playerIds: participantRows.map((row) => row.playerId),
  });
  return {
    ...current,
    rowsScanned: current.rowsScanned + comparison.rowsScanned,
    ...attachComparison(
      current.rows,
      rowsFromAggregates(
        plan,
        sortedAggregates(plan, comparison.aggregates),
        comparison.rowsScanned,
        2000,
      ).rows,
    ),
  };
}

async function executeCompetitionRankReport(
  params: ReportExecutionParams,
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

function queryRanges(
  plan: ReportQueryPlan,
  nowInput: Date | undefined,
  rangeOverride: TemporalRange | undefined,
): { current: TemporalRange; comparison: TemporalRange | null } {
  const now = nowInput ?? new Date();
  if (rangeOverride !== undefined) {
    return { current: rangeOverride, comparison: null };
  }
  if (plan.analysis === undefined) {
    return { current: lookbackRange(plan, now), comparison: null };
  }
  return resolveTemporalRanges(plan.analysis, now);
}

function competitionQueryRanges(
  competition: { startDate: Date | null; endDate: Date | null },
  plan: ReportQueryPlan,
  nowInput: Date | undefined,
  rangeOverride: TemporalRange | undefined,
): { current: TemporalRange; comparison: TemporalRange | null } {
  const now = nowInput ?? new Date();
  if (rangeOverride !== undefined) {
    return {
      current: clampTemporalRange(rangeOverride, competition, now),
      comparison: null,
    };
  }
  if (plan.analysis === undefined) {
    return {
      current: competitionRange(competition, plan, now),
      comparison: null,
    };
  }
  const ranges = resolveTemporalRanges(plan.analysis, now);
  return {
    current: clampTemporalRange(ranges.current, competition, now),
    comparison:
      ranges.comparison === null
        ? null
        : clampTemporalRange(ranges.comparison, competition, now),
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
  params: ReportExecutionParams,
  plan: ReportQueryPlan,
): number {
  const sourceCompetitionId = params.sourceCompetitionId ?? undefined;
  const competitionId = plan.competitionId ?? sourceCompetitionId;
  if (competitionId === undefined) {
    throw new Error("Competition-backed reports require a competition_id.");
  }
  if (
    sourceCompetitionId !== undefined &&
    plan.competitionId !== undefined &&
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

function attachComparison(
  currentRows: ReportResultRow[],
  comparisonRows: ReportResultRow[],
): { rows: ReportResultRow[]; comparisonRows: ReportResultRow[] } {
  const currentGroups = groupTemporalRows(currentRows);
  const comparisonGroups = groupTemporalRows(comparisonRows);
  const replacements = new Map<string, ReportResultRow>();
  for (const [seriesKey, currentGroup] of currentGroups) {
    const baselineGroup = comparisonGroups.get(seriesKey) ?? [];
    const sortedCurrent = currentGroup.toSorted(compareTemporalRows);
    const sortedBaseline = baselineGroup.toSorted(compareTemporalRows);
    sortedCurrent.forEach((row, index) => {
      const baseline = sortedBaseline[index];
      replacements.set(row.label, {
        ...row,
        values: row.values.map((value) => {
          const baselineValue = baseline?.values.find(
            (candidate) => candidate.column === value.column,
          )?.value;
          const numericBaseline =
            typeof baselineValue === "number" ? baselineValue : null;
          const numericValue =
            typeof value.value === "number" ? value.value : null;
          const deltas = comparisonDeltas(numericValue, numericBaseline);
          return {
            ...value,
            comparisonValue: baselineValue ?? null,
            absoluteDelta: deltas.absolute,
            percentageDelta: deltas.percentage,
          };
        }),
      });
    });
  }
  return {
    rows: currentRows.map((row) => replacements.get(row.label) ?? row),
    comparisonRows,
  };
}

function groupTemporalRows(
  rows: ReportResultRow[],
): Map<string, ReportResultRow[]> {
  const groups = new Map<string, ReportResultRow[]>();
  for (const row of rows) {
    const key = row.dimensions.slice(0, -1).join("\u{0}");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function compareTemporalRows(
  left: ReportResultRow,
  right: ReportResultRow,
): number {
  return (left.dimensions.at(-1) ?? "").localeCompare(
    right.dimensions.at(-1) ?? "",
  );
}
