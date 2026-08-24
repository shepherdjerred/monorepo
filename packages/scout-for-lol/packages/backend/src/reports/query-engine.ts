import type { ReportQueryPlan } from "@scout-for-lol/data";
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
import type { ReportQueryResult } from "#src/reports/query-types.ts";
import { resolvePlayerRefsToPuuids } from "#src/reports/identity.ts";
import {
  requireGuildScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import {
  cappedLimit,
  rowsFromAggregates,
  sortedAggregates,
} from "#src/reports/query-aggregates.ts";
import {
  calendarRange,
  clampTemporalRange,
  resolveTemporalRanges,
  type ResolvedTemporalRanges,
  type TemporalRange,
} from "#src/reports/temporal-range.ts";
import { attachTemporalComparison } from "#src/reports/temporal-comparison.ts";
import { buildVisualizationSnapshot } from "#src/reports/visualization-snapshot.ts";

export type ExecuteReportQueryParams = {
  prisma: ExtendedPrismaClient;
  /**
   * Which population to query. Guild scope is every scheduled and
   * user-authored report; global scope backs the explore surface and rejects
   * the competition sources below, which authorize against an owning server.
   */
  scope: LakeQueryScope;
  queryText: string;
  sourceCompetitionId?: number | null;
  now?: Date;
  onPlan?: ((plan: ReportQueryPlan) => void) | undefined;
  rangeOverride?: TemporalRange;
  /** The Discord servers a global-scope asker belongs to. Guild-scoped reports
   * resolve aliases from their own scope, including scheduled reports. */
  askerGuildIds?: string[] | undefined;
};
type ReportExecutionParams = Omit<
  ExecuteReportQueryParams,
  "queryText" | "onPlan"
>;

/**
 * Turn any `player('…')` names on the plan into PUUIDs.
 *
 * Undefined when the query has no player reference, so the ordinary path pays
 * for no lake reads. A query that does carry one and cannot be resolved throws
 * from `resolvePlayerRefsToPuuids` rather than matching nothing.
 */
async function resolvePlanPlayerRefs(
  params: Pick<ExecuteReportQueryParams, "askerGuildIds" | "scope">,
  plan: ReportQueryPlan,
): Promise<string[] | undefined> {
  if (plan.playerRefs.length === 0) return undefined;
  const guildIds =
    params.scope.kind === "guild"
      ? [params.scope.serverId]
      : (params.askerGuildIds ?? []);
  return await resolvePlayerRefsToPuuids({
    playerRefs: plan.playerRefs,
    guildIds,
    // Global callers without an asker have no permission-bounded alias scope.
    // A guild report always does: its execution scope is the boundary.
    aliasScopeAvailable: guildIds.length > 0,
  });
}

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
  const playerPuuids = await resolvePlanPlayerRefs(params, plan);
  const result = await runLakeAggregation({
    plan,
    scope: params.scope,
    playerPuuids,
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
    scope: params.scope,
    playerPuuids,
    startDate: ranges.comparison.startDate,
    endDate: ranges.comparison.endDate,
  });
  const comparisonResult = rowsFromAggregates(
    plan,
    sortedAggregates(plan, comparison.aggregates),
    comparison.rowsScanned,
    2000,
  );
  return {
    ...current,
    rowsScanned: current.rowsScanned + comparison.rowsScanned,
    ...attachTemporalComparison({
      currentRows: current.rows,
      comparisonRows: comparisonResult.rows,
      comparisonEvidence: comparisonResult.evidence,
      plan,
      ranges,
    }),
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
  const serverId = requireGuildScope(params.scope, "Competition reports");
  const competitionId = resolveCompetitionId(params, plan);
  const competition = parseCompetition(
    await params.prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== serverId) {
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
    scope: params.scope,
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
    scope: params.scope,
    startDate: ranges.comparison.startDate,
    endDate: ranges.comparison.endDate,
    playerIds: participantRows.map((row) => row.playerId),
  });
  const comparisonResult = rowsFromAggregates(
    plan,
    sortedAggregates(plan, comparison.aggregates),
    comparison.rowsScanned,
    2000,
  );
  return {
    ...current,
    rowsScanned: current.rowsScanned + comparison.rowsScanned,
    ...attachTemporalComparison({
      currentRows: current.rows,
      comparisonRows: comparisonResult.rows,
      comparisonEvidence: comparisonResult.evidence,
      plan,
      ranges: ranges.alignment,
    }),
  };
}

async function executeCompetitionRankReport(
  params: ReportExecutionParams,
  plan: ReportQueryPlan,
): Promise<ReportQueryResult> {
  const serverId = requireGuildScope(params.scope, "Competition reports");
  const competitionId = resolveCompetitionId(params, plan);
  const competition = parseCompetition(
    await params.prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== serverId) {
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

/**
 * The date range a non-ANALYZE plan covers.
 *
 * `all_time` starts at the epoch rather than at the lake's minimum timestamp:
 * the predicate compiles to a bound `BETWEEN` either way, no League match
 * predates 2009, and querying the lake for its own floor would add a round trip
 * to every all-time query to move a boundary that excludes nothing.
 */
function windowRange(
  plan: ReportQueryPlan,
  now: Date | undefined,
): TemporalRange {
  const endDate = now ?? new Date();
  const window = plan.window;
  if (window.kind === "all_time") {
    return { startDate: new Date(0), endDate };
  }
  if (window.kind === "relative") {
    // Clamped at the epoch: without the cap that used to bound this, a large
    // enough day count overflows past the Date range and every timestamp
    // parameter downstream becomes NaN. A window that reaches the epoch
    // already selects every row, so clamping loses nothing.
    const startMs = endDate.getTime() - window.days * 24 * 60 * 60 * 1000;
    return { startDate: new Date(Math.max(startMs, 0)), endDate };
  }
  return calendarRange(window.startDate, window.endDate, window.timezone);
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
    return { current: windowRange(plan, now), comparison: null };
  }
  return resolveTemporalRanges(plan.analysis, now);
}

export function competitionQueryRanges(
  competition: { startDate: Date | null; endDate: Date | null },
  plan: ReportQueryPlan,
  nowInput: Date | undefined,
  rangeOverride: TemporalRange | undefined,
): ResolvedTemporalRanges & { alignment: ResolvedTemporalRanges } {
  const now = nowInput ?? new Date();
  if (rangeOverride !== undefined) {
    const current = clampTemporalRange(rangeOverride, competition, now);
    return {
      current,
      comparison: null,
      alignment: { current, comparison: null },
    };
  }
  if (plan.analysis === undefined) {
    const current = competitionRange(competition, plan, now);
    return {
      current,
      comparison: null,
      alignment: { current, comparison: null },
    };
  }
  const requested = resolveTemporalRanges(plan.analysis, now);
  return {
    current: clampTemporalRange(requested.current, competition, now),
    comparison:
      requested.comparison === null
        ? null
        : clampTemporalRange(requested.comparison, competition, now),
    alignment: requested,
  };
}

function competitionRange(
  competition: { startDate: Date | null; endDate: Date | null },
  plan: ReportQueryPlan,
  nowInput: Date | undefined,
): { startDate: Date; endDate: Date } {
  // Intersect the competition's own dates with the period the query asked
  // for. Taking only the competition's bounds discarded the query's window
  // entirely, so `DURING BETWEEN` on a competition source silently widened to
  // the whole competition.
  const requested = windowRange(plan, nowInput);
  const now = nowInput ?? new Date();
  const configuredEnd = competition.endDate ?? now;
  const startDate =
    competition.startDate === null
      ? requested.startDate
      : new Date(
          Math.max(
            competition.startDate.getTime(),
            requested.startDate.getTime(),
          ),
        );
  const endDate = new Date(
    Math.min(
      configuredEnd.getTime(),
      now.getTime(),
      requested.endDate.getTime(),
    ),
  );
  return { startDate, endDate };
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
