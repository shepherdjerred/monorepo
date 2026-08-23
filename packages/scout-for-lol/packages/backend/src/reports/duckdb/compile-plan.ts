import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlEvidence,
  ScoutQlPredicate,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import {
  buildMatchesSource,
  buildPrematchSource,
  listParam,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import type {
  BoundParam,
  LakeFiles,
  SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import {
  buildPlanColumnMap,
  collectPredicateColumnNames,
  compilePredicate,
  countPredicateNodes,
  countScalarNodes,
  predicateTouchesIdentity,
  resolveColumn,
  type ColumnMap,
  type ExprContext,
  type PlanColumnSource,
} from "#src/reports/duckdb/expr-sql.ts";
import {
  collectAggregateColumnNames,
  collectHavingColumnNames,
  countAggregateNodes,
  countHavingNodes,
} from "#src/reports/duckdb/aggregate-sql.ts";
import {
  compilePlanGrouping,
  type CompiledGrouping,
} from "#src/reports/duckdb/group-sql.ts";
import {
  buildAggregateTail,
  buildFactsCte,
  type CompiledPlanColumns,
} from "#src/reports/duckdb/select-sql.ts";
import { combineAnd, frag, seq } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * ScoutQL v2 plan → parameterized DuckDB SQL for lake-backed sources.
 *
 * Preserved from the legacy compiler, verbatim in structure:
 * - the two-branch parquet ∪ staging union with QUALIFY dedupe (lake.ts),
 *   with the range predicate and every identity-free top-level WHERE conjunct
 *   pushed into BOTH branches before the dedupe window;
 * - the guild accounts-join / global NO-join identity rules (global scope
 *   labels rows from the Riot ID already on the fact — re-adding the join
 *   would double-count accounts tracked by more than one server);
 * - the `usableSource` empty-lake short-circuit (returns undefined);
 * - competition scoping as engine-resolved playerIds, never SQL-side
 *   competition metadata.
 *
 * Deliberately dropped: the legacy prematch rowsScanned asymmetry. For every
 * source, scannedSql counts the fully filtered facts rows.
 */

export type CompiledPlanQuery = {
  aggregateSql: string;
  aggregateParams: BoundParam[];
  scannedSql: string;
  scannedParams: BoundParam[];
  columns: CompiledPlanColumns;
};

export type PlanQueryInput = {
  plan: ScoutQlPlan;
  scope: LakeQueryScope;
  files: LakeFiles;
  /** Resolved execution range (engine passes epoch..now for unbounded). */
  range: { start: Date; end: Date };
  /** Resolved `player('…')` PUUIDs by playerRefs index. */
  playerPuuids?: Map<number, string[]> | undefined;
  /** Guild-only pre-resolved player scoping (competition path). */
  playerIds?: number[] | undefined;
  /** Effective limit, already policy-capped. */
  limit: number;
};

const PER_EXPRESSION_NODE_CAP = 64;
const PLAN_NODE_CAP = 256;

function cappedNodes(count: number, what: string): number {
  if (count > PER_EXPRESSION_NODE_CAP) {
    throw new Error(
      `${what} exceeds the ${PER_EXPRESSION_NODE_CAP.toString()}-node expression cap (${count.toString()} nodes).`,
    );
  }
  return count;
}

function evidenceExpressions(
  evidence: ScoutQlEvidence,
): ScoutQlAggregateExpr[] {
  return match(evidence)
    .with({ kind: "rate" }, (rate) => [rate.successes, rate.trials])
    .with({ kind: "ratio" }, (ratio) => [ratio.numerator, ratio.denominator])
    .with({ kind: "sample" }, () => [])
    .exhaustive();
}

function enforcePlanNodeBudget(plan: ScoutQlPlan): void {
  let total = 0;
  if (plan.where !== undefined) {
    total += cappedNodes(countPredicateNodes(plan.where), "WHERE");
  }
  if (plan.having !== undefined) {
    total += cappedNodes(countHavingNodes(plan.having), "HAVING");
  }
  for (const output of plan.outputs) {
    total +=
      output.expr.kind === "grouping-ref"
        ? 1
        : cappedNodes(
            countAggregateNodes(output.expr),
            `Output "${output.name}"`,
          );
    total += 1;
    for (const expr of evidenceExpressions(output.evidence)) {
      total += cappedNodes(countAggregateNodes(expr), "Evidence");
    }
  }
  for (const grouping of plan.groupings) {
    total +=
      grouping.kind === "expression"
        ? cappedNodes(countScalarNodes(grouping.expr), "GROUP BY expression")
        : 1;
  }
  if (total > PLAN_NODE_CAP) {
    throw new Error(
      `Plan exceeds the ${PLAN_NODE_CAP.toString()}-node budget (${total.toString()} nodes).`,
    );
  }
}

function referencedColumnNames(plan: ScoutQlPlan): Set<string> {
  const referenced = new Set<string>();
  if (plan.where !== undefined) {
    collectPredicateColumnNames(plan.where, referenced);
  }
  if (plan.having !== undefined) {
    collectHavingColumnNames(plan.having, referenced);
  }
  for (const output of plan.outputs) {
    if (output.expr.kind !== "grouping-ref") {
      collectAggregateColumnNames(output.expr, referenced);
    }
    for (const expr of evidenceExpressions(output.evidence)) {
      collectAggregateColumnNames(expr, referenced);
    }
  }
  return referenced;
}

function flattenConjuncts(pred: ScoutQlPredicate): ScoutQlPredicate[] {
  if (pred.kind === "and") {
    return pred.operands.flatMap((operand) => flattenConjuncts(operand));
  }
  return [pred];
}

type SourceKind = {
  columnSource: PlanColumnSource;
  timeColumn: "game_creation_at" | "observed_at";
};

function planSourceKind(plan: ScoutQlPlan, forGroupFacts: boolean): SourceKind {
  const kind = match(plan.source)
    .with(
      "match_participants",
      "competition_match_participants",
      "player_groups",
      (): SourceKind => ({
        columnSource: "match",
        timeColumn: "game_creation_at",
      }),
    )
    .with("prematch_participants", (): SourceKind => ({
      columnSource: "prematch",
      timeColumn: "observed_at",
    }))
    .with("rank_current", "competition_rank", () => {
      throw new Error(`rank sources are not lake-backed: ${plan.source}`);
    })
    .exhaustive();
  if ((plan.source === "player_groups") !== forGroupFacts) {
    throw new Error(
      forGroupFacts
        ? `${plan.source} does not use the group-facts projection.`
        : "player_groups compiles through compileGroupFactsProjection.",
    );
  }
  return kind;
}

function enforceScopeGuards(input: PlanQueryInput): void {
  if (input.scope.kind === "global" && input.playerIds !== undefined) {
    throw new Error(
      "playerIds scoping requires a guild scope — player ids are per-server.",
    );
  }
  // Rank sources threw in planSourceKind, so only the match flavor remains.
  if (input.plan.source === "competition_match_participants") {
    if (input.scope.kind === "global") {
      throw new Error("Competition reports are not available in global scope.");
    }
    if (input.plan.competitionId === undefined) {
      throw new Error(`${input.plan.source} requires a competition_id.`);
    }
  }
}

type SplitWhere = {
  /** Identity-free conjuncts, pushed into both union branches. */
  pushed: ScoutQlPredicate[];
  /** Conjuncts touching identity columns — compiled against the facts CTE. */
  residual: ScoutQlPredicate[];
};

function splitWhere(
  where: ScoutQlPredicate | undefined,
  columns: ColumnMap,
): SplitWhere {
  if (where === undefined) {
    return { pushed: [], residual: [] };
  }
  const pushed: ScoutQlPredicate[] = [];
  const residual: ScoutQlPredicate[] = [];
  for (const conjunct of flattenConjuncts(where)) {
    if (predicateTouchesIdentity(conjunct, columns)) {
      residual.push(conjunct);
    } else {
      pushed.push(conjunct);
    }
  }
  return { pushed, residual };
}

function rangePredicate(
  timeColumn: "game_creation_at" | "observed_at",
  range: { start: Date; end: Date },
): SqlFragment {
  return frag(`epoch_ms(${timeColumn}) BETWEEN ? AND ?`, [
    scalarParam(range.start.getTime()),
    scalarParam(range.end.getTime()),
  ]);
}

/**
 * Resolve every referenced column and return the source columns the facts CTE
 * must project (identity columns are always projected separately).
 */
function projectionDependencies(
  referenced: Set<string>,
  columns: ColumnMap,
): Set<string> {
  const dependencies = new Set<string>();
  for (const name of referenced) {
    const binding = resolveColumn(columns, name);
    if (binding.identity) continue;
    for (const dependency of binding.dependencies) {
      dependencies.add(dependency);
    }
  }
  return dependencies;
}

type FactsPipeline = {
  /** CTE prefix ending after facts (and filtered, when present). */
  prefix: SqlFragment;
  relation: "facts" | "filtered";
};

function buildFactsPipeline(
  input: PlanQueryInput,
  kind: SourceKind,
  columns: ColumnMap,
  extras: { projected: Set<string>; extraItems: SqlFragment[] },
): FactsPipeline | undefined {
  const factsContext: ExprContext = {
    columns,
    placement: "facts",
    playerPuuids: input.playerPuuids,
  };
  const sourceContext: ExprContext = { ...factsContext, placement: "source" };

  const { pushed, residual } = splitWhere(input.plan.where, columns);
  const pushdown = combineAnd([
    rangePredicate(kind.timeColumn, input.range),
    ...pushed.map((conjunct) => compilePredicate(conjunct, sourceContext)),
  ]);
  const source = match(kind.columnSource)
    .with("match", () => buildMatchesSource(input.files, pushdown))
    .with("prematch", () => buildPrematchSource(input.files, pushdown))
    .exhaustive();
  if (source === undefined) {
    return undefined;
  }
  if (
    input.scope.kind === "guild" &&
    input.files.accountsParquet === undefined
  ) {
    return undefined;
  }

  const facts = buildFactsCte({
    scope: input.scope,
    files: input.files,
    columnSource: kind.columnSource,
    source,
    projected: [...extras.projected],
    extraItems: extras.extraItems,
  });

  const residualFragments = residual.map((conjunct) =>
    compilePredicate(conjunct, factsContext),
  );
  if (input.playerIds !== undefined) {
    residualFragments.push(
      frag("player_id IN (SELECT unnest(?))", [listParam(input.playerIds)]),
    );
  }
  const residualWhere = combineAnd(residualFragments);
  if (residualWhere.sql.length === 0) {
    return { prefix: facts, relation: "facts" };
  }
  return {
    prefix: seq(
      facts,
      ", filtered AS (SELECT * FROM facts WHERE ",
      residualWhere,
      ")",
    ),
    relation: "filtered",
  };
}

export function compileScoutQlPlanQuery(
  input: PlanQueryInput,
): CompiledPlanQuery | undefined {
  const { plan } = input;
  enforcePlanNodeBudget(plan);
  const kind = planSourceKind(plan, false);
  enforceScopeGuards(input);
  if (input.playerIds?.length === 0) {
    // No competition participants: the answer is structurally empty.
    return undefined;
  }
  const columns = buildPlanColumnMap(kind.columnSource);

  const groupings: CompiledGrouping[] = plan.groupings.map((grouping) =>
    compilePlanGrouping({
      grouping,
      columns,
      scope: input.scope,
      source: kind.columnSource,
      timeColumn: kind.timeColumn,
      playerPuuids: input.playerPuuids,
    }),
  );

  const referenced = referencedColumnNames(plan);
  for (const grouping of groupings) {
    for (const name of grouping.columnNames) {
      referenced.add(name);
    }
  }
  const projected = projectionDependencies(referenced, columns);
  // The time column backs global arg_max labeling and date-trunc groupings;
  // puuid is always projected separately as `m.puuid AS puuid`.
  projected.add(kind.timeColumn);
  projected.delete("puuid");

  const pipeline = buildFactsPipeline(input, kind, columns, {
    projected,
    extraItems: [],
  });
  if (pipeline === undefined) {
    return undefined;
  }

  const { tail, columns: planColumns } = buildAggregateTail({
    plan,
    columns,
    scope: input.scope,
    groupings,
    playerPuuids: input.playerPuuids,
    factsRelation: pipeline.relation,
    limit: input.limit,
  });

  const aggregate = seq(pipeline.prefix, " ", tail);
  const scanned = seq(
    pipeline.prefix,
    ` SELECT (COUNT(*))::BIGINT AS scanned FROM ${pipeline.relation}`,
  );
  return {
    aggregateSql: aggregate.sql,
    aggregateParams: aggregate.params,
    scannedSql: scanned.sql,
    scannedParams: scanned.params,
    columns: planColumns,
  };
}

// ── player_groups raw-fact projection ────────────────────────────────────────

export type CompiledGroupFactsColumns = {
  playerId: "player_id";
  playerAlias: "player_alias";
  discordId: "discord_id";
  puuid: "puuid";
  matchId: "match_id";
  teamId: "team_id";
  playerSubteamId: "player_subteam_id";
  /** Referenced value columns, projected under their catalog/virtual names. */
  raw: string[];
};

export type CompiledGroupFactsProjection = {
  factsSql: string;
  factsParams: BoundParam[];
  scannedSql: string;
  scannedParams: BoundParam[];
  columns: CompiledGroupFactsColumns;
};

const GROUP_UNIT_COLUMNS = [
  "match_id",
  "team_id",
  "player_subteam_id",
] as const;

/**
 * player_groups: raw per-player fact rows for teammate-group units holding
 * ≥2 tracked players, exactly as the legacy compileGroupFactsQuery scoped
 * them. The group unit is (match, team, subteam) — Arena's team_id is a whole
 * 100/200 side spanning several unrelated 2-3 player subteams, so
 * player_subteam_id (NULL outside Arena) scopes the unit. Combination
 * generation and aggregate folding happen in JS; this projection carries the
 * unit/identity columns plus only the value columns the plan references.
 */
export function compileGroupFactsProjection(
  input: PlanQueryInput,
): CompiledGroupFactsProjection | undefined {
  const { plan } = input;
  enforcePlanNodeBudget(plan);
  const kind = planSourceKind(plan, true);
  if (input.scope.kind === "global") {
    throw new Error(
      "player_groups is not available in global scope — teammate groups are " +
        "defined by tracked accounts queueing together, which global match " +
        "facts cannot distinguish from random matchmaking.",
    );
  }
  if (plan.groupings.length !== 1 || plan.groupings[0]?.kind !== "group") {
    throw new Error("player_groups requires exactly GROUP BY group(...).");
  }
  if (input.playerIds?.length === 0) {
    return undefined;
  }
  const columns = buildPlanColumnMap(kind.columnSource);

  const referenced = referencedColumnNames(plan);
  const fixed = new Set<string>(["puuid", ...GROUP_UNIT_COLUMNS]);
  const rawNames: string[] = [];
  const projected = new Set<string>(GROUP_UNIT_COLUMNS);
  const extraItems: SqlFragment[] = [];
  for (const name of [...referenced].toSorted()) {
    const binding = resolveColumn(columns, name);
    if (binding.identity || fixed.has(name)) continue;
    rawNames.push(name);
    if (binding.sql === name) {
      projected.add(name);
    } else {
      // Virtual dimension: computed in the facts CTE under its own name, with
      // its source dependencies also projected for facts-context predicates.
      extraItems.push(frag(`(${binding.sql}) AS ${name}`));
      for (const dependency of binding.dependencies) {
        projected.add(dependency);
      }
    }
  }

  const pipeline = buildFactsPipeline(input, kind, columns, {
    projected,
    extraItems,
  });
  if (pipeline === undefined) {
    return undefined;
  }

  // One row per (match, team, subteam, player): when a player has two tracked
  // accounts in one match, keep a deterministic one (lowest puuid).
  const dedupe =
    ", deduped AS (SELECT * FROM " +
    pipeline.relation +
    " QUALIFY row_number() OVER (PARTITION BY match_id, team_id, player_subteam_id, player_id ORDER BY puuid) = 1)";
  const finalColumns = [
    "player_id",
    "player_alias",
    "discord_id",
    "puuid",
    ...GROUP_UNIT_COLUMNS,
    ...rawNames,
  ].join(", ");
  const facts = seq(
    pipeline.prefix,
    dedupe,
    ` SELECT ${finalColumns} FROM deduped QUALIFY count(*) OVER (PARTITION BY match_id, team_id, player_subteam_id) >= 2`,
  );
  const scanned = seq(
    pipeline.prefix,
    ` SELECT (COUNT(*))::BIGINT AS scanned FROM ${pipeline.relation}`,
  );
  return {
    factsSql: facts.sql,
    factsParams: facts.params,
    scannedSql: scanned.sql,
    scannedParams: scanned.params,
    columns: {
      playerId: "player_id",
      playerAlias: "player_alias",
      discordId: "discord_id",
      puuid: "puuid",
      matchId: "match_id",
      teamId: "team_id",
      playerSubteamId: "player_subteam_id",
      raw: rawNames,
    },
  };
}
