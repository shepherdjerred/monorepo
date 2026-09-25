import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlHavingPredicate,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import {
  type AggregateWalkNode,
  walkAggregateExpr,
  walkHavingPredicate,
} from "#src/reports/duckdb/aggregate-sql.ts";
import type { ColumnMap } from "#src/reports/duckdb/column-map.ts";
import { compileScalarExpr } from "#src/reports/duckdb/expr-sql.ts";
import type { CompiledGrouping } from "#src/reports/duckdb/group-sql.ts";
import {
  isTrackedScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import { frag, joinFragments, seq } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * LONGEST_STREAK and CURRENT_STREAK: runs of consecutive games, per player,
 * in game order.
 *
 * An aggregate cannot see order, so a window step runs between the facts
 * and the GROUP BY. Every row survives it — other outputs of the query still
 * count them — and gains, per streak, the length of the run it belongs to
 * and of the player's last run. The tail's streak output is then a plain
 * MAX over those columns. It is the gaps-and-islands shape the Dare contract
 * reference uses (dare-sql-v3-semantics.integration.test.ts): every miss
 * starts a new island, and an island's hits are its run.
 *
 * Games are ordered by game end, then match, then puuid, as any stable
 * selection must be. A player is one partition however many accounts they
 * have, and a game two of their accounts played counts once. The WHERE has
 * already removed the games it excludes, so an excluded game is skipped,
 * never a miss.
 */

export type StreakNode = Extract<ScoutQlAggregateExpr, { kind: "streak" }>;

export type StreakStep = {
  /** CTEs to append after the facts pipeline, each prefixed by ", ". */
  ctes: SqlFragment;
  relation: "streaks";
  resolveStreak: (node: StreakNode) => SqlFragment;
};

/** Every streak node in the plan's outputs and HAVING. */
export function collectStreaks(plan: ScoutQlPlan): StreakNode[] {
  const found: StreakNode[] = [];
  const visit = (node: AggregateWalkNode | ScoutQlHavingPredicate): void => {
    if (node.kind === "streak") found.push(node);
  };
  for (const output of plan.outputs) {
    if (output.expr.kind !== "grouping-ref") {
      walkAggregateExpr(output.expr, visit);
    }
  }
  if (plan.having !== undefined) {
    walkHavingPredicate(plan.having, visit);
  }
  return found;
}

/** The resolver for a plan with no streak: reaching it is a compiler bug. */
export function unsupportedStreak(): SqlFragment {
  throw new Error("A streak was compiled without its window step.");
}

/** Columns a streak step reads beyond what the plan references. */
export const STREAK_ORDER_COLUMNS = ["game_end_at", "match_id"] as const;

export function buildStreakStep(input: {
  streaks: readonly StreakNode[];
  relation: string;
  scope: LakeQueryScope;
  groupings: readonly CompiledGrouping[];
  columns: ColumnMap;
  playerPuuids: Map<number, string[]> | undefined;
}): StreakStep {
  // One set of columns per distinct condition, however often it is named.
  const indexByArg = new Map<string, number>();
  const hits: SqlFragment[] = [];
  for (const node of input.streaks) {
    const key = JSON.stringify(node.arg);
    if (indexByArg.has(key)) continue;
    const index = indexByArg.size;
    indexByArg.set(key, index);
    const condition = compileScalarExpr(node.arg, {
      columns: input.columns,
      placement: "facts",
      playerPuuids: input.playerPuuids,
    });
    hits.push(
      seq(
        "CASE WHEN __dup = 1 THEN CASE WHEN (",
        condition,
        `) IS TRUE THEN 1 ELSE 0 END END AS __h_${index.toString()}`,
      ),
    );
  }
  // Tracked scopes key a person on player_id, across all their accounts;
  // global scope has no person, only the account. Grouping keys join the
  // partition so a streak never crosses groups; they are materialised as
  // columns once, so their bound parameters are compiled a single time.
  const player = isTrackedScope(input.scope) ? "player_id" : "puuid";
  const keyColumns = input.groupings.map(
    (_, index) => `__sk_${index.toString()}`,
  );
  const partition = [player, ...keyColumns].join(", ");
  const keyed = seq(
    "SELECT *",
    ...input.groupings.map((grouping, index) =>
      seq(", (", grouping.key, `) AS __sk_${index.toString()}`),
    ),
    ` FROM ${input.relation}`,
  );
  const indexes = [...indexByArg.values()].map((index) => index.toString());
  const misses = indexes.map(
    (i) =>
      `SUM(CASE WHEN __h_${i} = 0 THEN 1 ELSE 0 END) OVER (PARTITION BY ${partition} ORDER BY game_end_at, match_id, puuid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS __m_${i}`,
  );
  const runs = indexes.map(
    (i) =>
      `SUM(__h_${i}) OVER (PARTITION BY ${partition}, __m_${i}) AS __lrun_${i}, ` +
      `CASE WHEN __m_${i} = MAX(__m_${i}) OVER (PARTITION BY ${partition}) ` +
      `THEN SUM(__h_${i}) OVER (PARTITION BY ${partition}, __m_${i}) ELSE 0 END AS __crun_${i}`,
  );
  const ctes = seq(
    ", streak_rows AS (SELECT *, ",
    `row_number() OVER (PARTITION BY ${partition}, match_id ORDER BY puuid) AS __dup FROM (`,
    keyed,
    "))",
    ", streak_base AS (SELECT *, ",
    joinFragments(hits, ", "),
    " FROM streak_rows)",
    `, streak_runs AS (SELECT *, ${misses.join(", ")} FROM streak_base)`,
    `, streaks AS (SELECT *, ${runs.join(", ")} FROM streak_runs)`,
  );
  return {
    ctes,
    relation: "streaks",
    resolveStreak: (node) => {
      const index = indexByArg.get(JSON.stringify(node.arg));
      if (index === undefined) {
        throw new Error("A streak was compiled without its window step.");
      }
      const column = node.mode === "longest" ? "__lrun" : "__crun";
      return frag(`(coalesce(MAX(${column}_${index.toString()}), 0))::BIGINT`);
    },
  };
}
