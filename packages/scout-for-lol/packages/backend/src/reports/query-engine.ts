import { CompetitionIdSchema, parseCompetition } from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scoutReportQueryDurationSeconds,
  scoutReportQueryRunsTotal,
} from "#src/metrics/report-query.ts";
import { runPlanAggregation } from "#src/reports/duckdb/execute.ts";
import { ReportQueryTimeoutError } from "#src/reports/duckdb/instance.ts";
import { resolvePlayerRefPuuids } from "#src/reports/identity.ts";
import type { ReportQueryResult } from "#src/reports/query-types.ts";
import {
  requireGuildScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import {
  effectiveRowLimit,
  resultFromPlanRows,
  withoutComparison,
} from "#src/reports/query-aggregates.ts";
import { rankReportResult } from "#src/reports/rank-report.ts";
import {
  clampTemporalRange,
  type TemporalRange,
} from "#src/reports/temporal-range.ts";
import {
  resolveTemporalContext,
  windowRange,
  type TemporalContext,
} from "#src/reports/temporal-plan.ts";
import { mergeTemporalPeriods } from "#src/reports/temporal-comparison.ts";
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
  onPlan?: ((plan: ScoutQlPlan) => void) | undefined;
  rangeOverride?: TemporalRange;
  /** The Discord servers a global-scope asker belongs to. Guild-scoped reports
   * resolve aliases from their own scope, including scheduled reports. */
  askerGuildIds?: string[] | undefined;
};
type ReportExecutionParams = Omit<
  ExecuteReportQueryParams,
  "queryText" | "onPlan"
>;

export class InvalidSavedQueryError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "InvalidSavedQueryError";
  }
}

/**
 * Turn any `player('…')` names on the plan into PUUIDs, by reference index.
 *
 * Undefined when the query has no player reference, so the ordinary path pays
 * for no lake reads. A query that does carry one and cannot be resolved throws
 * rather than matching nothing.
 */
async function resolvePlanPlayerRefs(
  params: Pick<ExecuteReportQueryParams, "askerGuildIds" | "scope">,
  plan: ScoutQlPlan,
): Promise<Map<number, string[]> | undefined> {
  if (plan.playerRefs.length === 0) return undefined;
  const guildIds =
    params.scope.kind === "guild"
      ? [params.scope.serverId]
      : (params.askerGuildIds ?? []);
  return await resolvePlayerRefPuuids({
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
 * Lake-backed sources (match_participants, player_groups,
 * prematch_participants, competition_match_participants) run as compiled SQL
 * on embedded DuckDB over the report lake (see reports/duckdb/); the rank
 * snapshot sources have no lake table at all and delegate to the leaderboard.
 */
export async function executeReportQuery(
  params: ExecuteReportQueryParams,
): Promise<ReportQueryResult> {
  const startedAt = Date.now();
  // Labeled "unknown" until the plan compiles, so a compile failure still
  // records an error datapoint (with an honest source) rather than nothing.
  let source = "unknown";
  try {
    let plan: ScoutQlPlan;
    try {
      plan = compileScoutQl(params.queryText);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InvalidSavedQueryError(message, error);
    }
    source = plan.source;
    params.onPlan?.(plan);
    const result = await executeCompiledReportQuery(params, plan);
    recordReportQueryMetrics(source, "success", startedAt);
    return result;
  } catch (error) {
    recordReportQueryMetrics(source, outcomeOf(error), startedAt);
    throw error;
  }
}

export async function executeCompiledReportQuery(
  params: Omit<ExecuteReportQueryParams, "queryText" | "onPlan">,
  plan: ScoutQlPlan,
): Promise<ReportQueryResult> {
  const result = await runReportQueryPlan(params, plan);
  return {
    ...result,
    visualization: buildVisualizationSnapshot(result, params.now ?? new Date()),
  };
}

/** A timed-out query is its own outcome: it says nothing about the query's
 * validity, and folding it into `error` hides the one failure mode an operator
 * can act on by raising the budget or narrowing the window. */
function outcomeOf(error: unknown): "error" | "timeout" {
  return error instanceof ReportQueryTimeoutError ? "timeout" : "error";
}

function recordReportQueryMetrics(
  source: string,
  outcome: "success" | "error" | "timeout",
  startedAt: number,
): void {
  scoutReportQueryRunsTotal.inc({ source, outcome });
  scoutReportQueryDurationSeconds.observe(
    { source, outcome },
    (Date.now() - startedAt) / 1000,
  );
}

async function runReportQueryPlan(
  params: ReportExecutionParams,
  plan: ScoutQlPlan,
): Promise<ReportQueryResult> {
  if (plan.source === "competition_rank" || plan.source === "rank_current") {
    return await rankReportResult({
      prisma: params.prisma,
      scope: params.scope,
      plan,
      competitionId: resolveCompetitionId(params, plan),
      now: params.now ?? new Date(),
    });
  }
  const now = params.now ?? new Date();
  const playerIds =
    plan.source === "competition_match_participants"
      ? await competitionPlayerIds(params, plan)
      : undefined;
  const { range, competition } = await planQueryRange(params, plan, now);
  const playerPuuids = await resolvePlanPlayerRefs(params, plan);
  const limit = effectiveRowLimit(plan);
  const current = await runPlanAggregation({
    plan,
    scope: params.scope,
    range: { start: range.startDate, end: range.endDate },
    limit,
    playerPuuids,
    playerIds,
  });
  const context = resolveTemporalContext(plan, range);
  if (context === null) {
    return resultFromPlanRows({
      plan,
      rows: withoutComparison(current.rows),
      rowsScanned: current.rowsScanned,
      range,
    });
  }
  const baselineRange = comparisonExecutionRange(competition, context, now);
  const baseline =
    baselineRange === null
      ? { rows: [], rowsScanned: 0 }
      : await runPlanAggregation({
          plan,
          scope: params.scope,
          range: { start: baselineRange.startDate, end: baselineRange.endDate },
          limit,
          playerPuuids,
          playerIds,
        });
  return resultFromPlanRows({
    plan,
    rows: mergeTemporalPeriods({
      plan,
      context,
      current: current.rows,
      comparison: baseline.rows,
    }),
    rowsScanned: current.rowsScanned + baseline.rowsScanned,
    range,
    temporal: context,
  });
}

/**
 * The comparison period's EXECUTION range. A competition clamps it to its own
 * dates — there are no games outside them — while the context keeps the
 * unclamped range, because that is what the bucket offsets align against.
 */
function comparisonExecutionRange(
  competition: CompetitionBoundary | null,
  context: TemporalContext,
  now: Date,
): TemporalRange | null {
  const requested = context.ranges.comparison;
  if (competition === null) return requested;
  const start =
    competition.startDate === null ||
    requested.startDate >= competition.startDate
      ? requested.startDate
      : competition.startDate;
  const configuredEnd = competition.endDate ?? now;
  const end = new Date(
    Math.min(
      requested.endDate.getTime(),
      configuredEnd.getTime(),
      now.getTime(),
    ),
  );
  // A baseline entirely before the competition began is empty, not an error:
  // the current period is what the author asked for, and refusing the whole
  // report because its comparison predates the competition would be a failure
  // where "no games yet" is the honest answer.
  return start > end ? null : { startDate: start, endDate: end };
}

export type CompetitionBoundary = {
  startDate: Date | null;
  endDate: Date | null;
};

async function planQueryRange(
  params: ReportExecutionParams,
  plan: ScoutQlPlan,
  now: Date,
): Promise<{ range: TemporalRange; competition: CompetitionBoundary | null }> {
  if (plan.source !== "competition_match_participants") {
    return {
      range: params.rangeOverride ?? windowRange(plan.timeWindow, now),
      competition: null,
    };
  }
  const competition = await loadCompetition(params, plan);
  return {
    range: competitionQueryRange(competition, plan, now, params.rangeOverride),
    competition,
  };
}

export function competitionQueryRange(
  competition: { startDate: Date | null; endDate: Date | null },
  plan: ScoutQlPlan,
  nowInput: Date | undefined,
  rangeOverride: TemporalRange | undefined,
): TemporalRange {
  const now = nowInput ?? new Date();
  if (rangeOverride !== undefined) {
    return clampTemporalRange(rangeOverride, competition, now);
  }
  // Intersect the competition's own dates with the period the query asked
  // for. Taking only the competition's bounds would discard the query's window
  // entirely, so a bounded window on a competition source silently widened to
  // the whole competition.
  const requested = windowRange(plan.timeWindow, now);
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

async function loadCompetition(
  params: ReportExecutionParams,
  plan: ScoutQlPlan,
): Promise<CompetitionBoundary> {
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
  return { startDate: competition.startDate, endDate: competition.endDate };
}

async function competitionPlayerIds(
  params: ReportExecutionParams,
  plan: ScoutQlPlan,
): Promise<number[]> {
  const competitionId = resolveCompetitionId(params, plan);
  const rows = await params.prisma.competitionParticipant.findMany({
    where: {
      competitionId: CompetitionIdSchema.parse(competitionId),
      joinedAt: { not: null },
    },
    select: { playerId: true },
  });
  return rows.map((row) => row.playerId);
}

export function resolveCompetitionId(
  params: Pick<ExecuteReportQueryParams, "sourceCompetitionId">,
  plan: ScoutQlPlan,
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
