import {
  RankSchema,
  parseCompetition,
  rankToLeaguePoints,
  rankToString,
} from "@scout-for-lol/data";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  calculateLeaderboard,
  type RankedLeaderboardEntry,
} from "#src/league/competition/leaderboard.ts";
import type { CachedLeaderboardEntry } from "@scout-for-lol/data";
import { collectAggregateColumnNames } from "#src/reports/duckdb/aggregate-sql.ts";
import {
  requireGuildScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import {
  effectiveRowLimit,
  resultFromPlanRows,
  withoutComparison,
} from "#src/reports/query-aggregates.ts";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";
import {
  evaluateAggregate,
  evaluateHaving,
  evaluatePredicate,
  type AggregateEvalContext,
  type FactRow,
} from "#src/reports/aggregate-eval.ts";
import {
  compareOutputs,
  groupEvidence,
} from "#src/reports/group-combinations.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import type {
  PlanAggregateRow,
  PlanOutputValue,
} from "#src/reports/plan-rows.ts";

/**
 * The rank snapshot sources (`rank_current`, `competition_rank`).
 *
 * These have no lake table: a "current rank" is a live standing, computed by
 * the competition leaderboard from the database. Their catalog exposes exactly
 * two measurable columns — `score` and `rank` — and no time column at all,
 * which is why their plans carry a `snapshot` window.
 *
 * WHERE, HAVING, ORDER BY and GROUP BY all run in JS here, the same way
 * `player_groups` folds and aggregates in JS (aggregate-eval.ts,
 * group-combinations.ts) rather than SQL: a leaderboard entry never exists as
 * a lake relation DuckDB could query. `score`/`rank` cannot be named as a
 * GROUP BY key (catalog `groupBy: false`), so the only grouping this source
 * can ever receive is `GROUP BY player` — every group is a singleton, since
 * the leaderboard already has exactly one row per player — or no grouping at
 * all, which aggregates every surviving entry into one grand-total row.
 */

export type RankReportInput = {
  prisma: ExtendedPrismaClient;
  scope: LakeQueryScope;
  plan: ScoutQlPlan;
  competitionId: number;
  now: Date;
};

type RankGroup = {
  label: string;
  playerId: number | null;
  discordId: string | null;
  keys: LakeScalar[];
  entries: RankedLeaderboardEntry[];
};

export async function rankReportResult(
  input: RankReportInput,
): Promise<ReportQueryResult> {
  const serverId = requireGuildScope(input.scope, "Competition reports");
  const competition = parseCompetition(
    await input.prisma.competition.findUniqueOrThrow({
      where: { id: input.competitionId },
      include: { season: true },
    }),
  );
  if (competition.serverId !== serverId) {
    throw new Error("Report competition does not belong to this server.");
  }
  const leaderboard = await calculateLeaderboard(input.prisma, competition);
  const showsRankNames = competition.criteria.type === "HIGHEST_RANK";

  return resultFromPlanRows({
    plan: input.plan,
    rows: withoutComparison(
      aggregateRankLeaderboard(input.plan, leaderboard, showsRankNames),
    ),
    rowsScanned: leaderboard.length,
    // A snapshot answers "as of now"; it has no window to state.
    range: { startDate: new Date(0), endDate: input.now },
  });
}

/**
 * Evaluate the plan's WHERE, GROUP BY, outputs, HAVING, ORDER BY and LIMIT
 * over an already-computed leaderboard. Pulled out of `rankReportResult` so
 * this — the part under test — needs no database or S3 access.
 *
 * Every output stays numeric through HAVING and ORDER BY; rank-name display
 * formatting is a final pass applied only to the rows that survive, over the
 * whole leaderboard, so a `HIGHEST_RANK` competition's `ORDER BY score DESC`
 * sorts on league points rather than lexicographically on rendered strings
 * like "Diamond II" vs "Emerald I" (Emerald sorts alphabetically first, but
 * outranks nothing — DuckDB's own tier ordering would put it well behind).
 */
export function aggregateRankLeaderboard(
  plan: ScoutQlPlan,
  leaderboard: RankedLeaderboardEntry[],
  showsRankNames: boolean,
): PlanAggregateRow[] {
  const limit = effectiveRowLimit(plan);
  const where = plan.where;
  const survivors =
    where === undefined
      ? leaderboard
      : leaderboard.filter(
          (entry) => evaluatePredicate(where, factRowFor(entry)) === true,
        );

  const groups = rankGroups(plan, survivors);
  const rows = groups.flatMap((group) => rankGroupRow(plan, group));
  const ordered = rows
    .toSorted((left, right) => compareRankRows(left, right, plan))
    .slice(0, limit);
  return showsRankNames
    ? ordered.map((row) => formatRankNames(plan, row, leaderboard))
    : ordered;
}

function factRowFor(entry: RankedLeaderboardEntry): FactRow {
  return new Map<string, LakeScalar>([
    ["rank", entry.rank],
    ["score", scoreToNumber(entry.score)],
    ["player", entry.playerName],
  ]);
}

/**
 * Partition surviving entries into the only two grouping shapes this source
 * can ever receive: no grouping (one grand-total group over everything) or
 * `GROUP BY player` (one singleton group per surviving entry). Any other
 * shape would mean the catalog's `groupBy: false` on score/rank stopped being
 * enforced upstream — fail loudly rather than silently mis-group.
 */
function rankGroups(
  plan: ScoutQlPlan,
  survivors: RankedLeaderboardEntry[],
): RankGroup[] {
  const [grouping, ...rest] = plan.groupings;
  if (grouping === undefined) {
    return [
      {
        label: "All",
        playerId: null,
        discordId: null,
        keys: [],
        entries: survivors,
      },
    ];
  }
  if (
    rest.length > 0 ||
    grouping.kind !== "column" ||
    grouping.column !== "player"
  ) {
    throw new Error(
      "unreachable: rank sources may only GROUP BY player (score/rank are not valid grouping keys).",
    );
  }
  return survivors.map((entry) => ({
    label: entry.playerName,
    playerId: entry.playerId,
    discordId: entry.discordId ?? null,
    keys: [entry.playerName],
    entries: [entry],
  }));
}

/** Evaluate one group's outputs and HAVING; returns no row when HAVING fails. */
function rankGroupRow(plan: ScoutQlPlan, group: RankGroup): PlanAggregateRow[] {
  const outputs = new Map<string, LakeScalar>();
  const ctx: AggregateEvalContext = {
    rows: group.entries.map((entry) => factRowFor(entry)),
    outputs,
    filterableColumns: new Set(["rank", "score", "player"]),
  };
  const values: PlanOutputValue[] = plan.outputs.map((output) => {
    const value = rankOutputValue(output, group, ctx);
    outputs.set(output.name, value);
    return {
      name: output.name,
      value: typeof value === "boolean" ? String(value) : value,
      evidence: groupEvidence(output.evidence, ctx),
    };
  });
  if (plan.having !== undefined && !evaluateHaving(plan.having, ctx)) {
    return [];
  }
  return [
    {
      label: group.label,
      playerId: group.playerId,
      discordId: group.discordId,
      keys: group.keys,
      groupMembers: null,
      outputs: values,
    },
  ];
}

/**
 * What one output evaluates to over a group: a grouping echo, or the plan's
 * aggregate expression evaluated numerically. Display formatting (rank names)
 * is deliberately NOT done here — see `formatRankNames` — so HAVING and
 * ORDER BY always compare the same numbers the SQL path would.
 */
function rankOutputValue(
  output: ScoutQlOutput,
  group: RankGroup,
  ctx: AggregateEvalContext,
): LakeScalar {
  if (output.expr.kind === "grouping-ref") {
    return group.keys[output.expr.index] ?? null;
  }
  return evaluateAggregate(output.expr, ctx);
}

/**
 * The final display pass: for every output whose expression reads `score`,
 * substitute a rank name for exactly the numeric values that reproduce one
 * real leaderboard entry's score (MIN/MAX, or any aggregate over the
 * singleton `GROUP BY player` groups always produces one). SUM/AVG across
 * several entries has no rank of its own and is left as the plain
 * league-points number. `rank` (a plain standings position) is never
 * formatted, and this runs only after HAVING/ORDER BY/LIMIT have already
 * used the numeric values.
 */
function formatRankNames(
  plan: ScoutQlPlan,
  row: PlanAggregateRow,
  leaderboard: RankedLeaderboardEntry[],
): PlanAggregateRow {
  return {
    ...row,
    outputs: row.outputs.map((output, index) => {
      const expr = plan.outputs[index]?.expr;
      if (
        expr === undefined ||
        expr.kind === "grouping-ref" ||
        typeof output.value !== "number"
      ) {
        return output;
      }
      const referenced = new Set<string>();
      collectAggregateColumnNames(expr, referenced);
      if (!referenced.has("score")) {
        return output;
      }
      const source = leaderboard.find(
        (entry) => scoreToNumber(entry.score) === output.value,
      );
      return source === undefined
        ? output
        : { ...output, value: rankToString(RankSchema.parse(source.score)) };
    }),
  };
}

function scoreToNumber(score: CachedLeaderboardEntry["score"]): number {
  const rank = RankSchema.safeParse(score);
  if (rank.success) {
    return rankToLeaguePoints(rank.data);
  }
  return typeof score === "number" ? score : 0;
}

function compareRankRows(
  left: PlanAggregateRow,
  right: PlanAggregateRow,
  plan: ScoutQlPlan,
): number {
  for (const key of plan.orderBy) {
    const comparison = compareOutputs(
      rankOrderValue(left, key.target),
      rankOrderValue(right, key.target),
      key.direction,
    );
    if (comparison !== 0) return comparison;
  }
  return left.label.localeCompare(right.label);
}

function rankOrderValue(
  row: PlanAggregateRow,
  target: ScoutQlPlan["orderBy"][number]["target"],
): number | string | null {
  if (target.kind === "grouping") {
    const key = row.keys[target.index];
    return typeof key === "boolean" ? String(key) : (key ?? null);
  }
  const output = row.outputs.find(
    (candidate) => candidate.name === target.name,
  );
  if (output === undefined) {
    throw new Error(`ORDER BY target "${target.name}" is not an output.`);
  }
  return output.value;
}
