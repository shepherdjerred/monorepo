import { match } from "ts-pattern";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { buildAccountsSource, scalarParam } from "#src/reports/duckdb/lake.ts";
import type { LakeFiles, SqlFragment } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import {
  compileAggregateExpr,
  compileHavingPredicate,
  type AggregateContext,
} from "#src/reports/duckdb/aggregate-sql.ts";
import type {
  ColumnMap,
  PlanColumnSource,
} from "#src/reports/duckdb/column-map.ts";
import {
  groupingLabelJoin,
  type CompiledGrouping,
} from "#src/reports/duckdb/group-sql.ts";
import {
  combineAnd,
  frag,
  joinFragments,
  seq,
} from "#src/reports/duckdb/sql-fragment.ts";

/**
 * SELECT-statement assembly for the plan compiler.
 *
 * SQL column aliases are POSITIONAL — `expr_i` for outputs, `__key_i` for
 * grouping keys, `__succ_i`/`__n_i`/`__num_i`/`__den_i` for evidence
 * companions. User-authored output names never reach SQL; CompiledPlanColumns
 * maps them back. Hidden columns: `label` (legacy labeling), `player_id` /
 * `discord_id` (guild identity; NULL in global scope), one typed key per
 * grouping, and per-output evidence companions (deduplicated by SQL text).
 */

export type FactsCteInput = {
  scope: LakeQueryScope;
  files: LakeFiles;
  columnSource: PlanColumnSource;
  source: SqlFragment;
  /**
   * Participant rows the match dimension is derived from — match_teams only,
   * where the time window and every match-level column live.
   */
  matchDimension?: SqlFragment | undefined;
  /**
   * The match_teams rows a participant's team is looked up from — present
   * only when the plan names a team lookup column.
   */
  teamDimension?: SqlFragment | undefined;
  /** Value columns to project as `m.X AS X` (identity handled separately). */
  projected: string[];
  /** Extra computed items (group-facts virtual columns), already fragments. */
  extraItems: SqlFragment[];
};

function identityProjection(
  scope: LakeQueryScope,
  columnSource: PlanColumnSource,
): string {
  if (scope.kind === "guild") {
    return "a.player_id AS player_id, a.player_alias AS player_alias, a.discord_id AS discord_id";
  }
  // Global scope: no accounts dimension exists, so the row labels itself with
  // the Riot ID already on the fact. player_alias keeps its name so both
  // scopes produce the same facts shape.
  const alias = match(columnSource)
    .with(
      "match",
      () =>
        "concat_ws('#', m.riot_id_game_name, m.riot_id_tagline) AS player_alias",
    )
    .with("prematch", () => "m.riot_id AS player_alias")
    // A team is not a player and has no name to label itself with. The column
    // keeps its place so the facts shape stays uniform; the grouping arms
    // reject `player` on this source, so nothing ever reads it.
    .with("match-team", () => "NULL::VARCHAR AS player_alias")
    .exhaustive();
  return `NULL::BIGINT AS player_id, ${alias}, NULL::VARCHAR AS discord_id`;
}

/**
 * One row per match, carrying the facts a team row lacks.
 *
 * Collapsed with `any_value` over `GROUP BY match_id` rather than `DISTINCT`:
 * these are match-level fields repeated on all ten participant rows, and
 * grouping guarantees one row per match even if a single field ever disagreed
 * between them. That is what keeps the join from fanning a team row out.
 */
function matchDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "WITH match_dim AS (SELECT match_id, any_value(game_creation_at) AS game_creation_at, any_value(queue) AS queue, any_value(",
    frag(String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`),
    ") AS patch, any_value(map_id) AS map_id FROM (",
    dimension,
    ") GROUP BY match_id)",
  );
}

/** One row per (match, team), for the same reason the match dimension is grouped. */
function teamDimensionCte(dimension: SqlFragment): SqlFragment {
  return seq(
    "team_dim AS (SELECT match_id, team_id, any_value(champion_kills) AS team_champion_kills FROM (",
    dimension,
    ") GROUP BY match_id, team_id)",
  );
}

const TEAM_LOOKUP_ITEMS = "t.team_champion_kills AS team_champion_kills";
const TEAM_LOOKUP_JOIN =
  " LEFT JOIN team_dim t ON t.match_id = m.match_id AND t.team_id = m.team_id";

const MATCH_DIMENSION_ITEMS =
  "d.game_creation_at AS game_creation_at, d.queue AS queue, d.patch AS patch, d.map_id AS map_id";

/**
 * The facts CTE: identity + puuid + every referenced source column over the
 * union source. Guild scope joins the server's accounts dimension; global
 * scope never joins it (re-adding the join would double-count accounts
 * tracked by more than one server).
 */
export function buildFactsCte(input: FactsCteInput): SqlFragment {
  const projected = input.projected
    .toSorted()
    .map((name) => `m.${name} AS ${name}`)
    .join(", ");
  const teamSource = input.columnSource === "match-team";
  const team = input.teamDimension;
  const items = joinFragments(
    [
      frag(identityProjection(input.scope, input.columnSource)),
      ...(team === undefined ? [] : [frag(TEAM_LOOKUP_ITEMS)]),
      // No puuid exists on a team row; the column is held open as NULL so the
      // facts shape does not vary by source.
      frag(teamSource ? "NULL::VARCHAR AS puuid" : "m.puuid AS puuid"),
      frag(projected),
      ...(teamSource ? [frag(MATCH_DIMENSION_ITEMS)] : []),
      ...input.extraItems,
    ],
    ", ",
  );
  if (teamSource) {
    const dimension = input.matchDimension;
    if (dimension === undefined) {
      throw new Error("match_teams compile requires a match dimension.");
    }
    return seq(
      matchDimensionCte(dimension),
      ", facts AS (SELECT ",
      items,
      " FROM (",
      input.source,
      ") m JOIN match_dim d ON d.match_id = m.match_id)",
    );
  }
  const teamCte =
    team === undefined ? frag("") : seq(teamDimensionCte(team), ", ");
  const teamJoin = team === undefined ? "" : TEAM_LOOKUP_JOIN;
  if (input.scope.kind === "global") {
    return seq(
      "WITH ",
      teamCte,
      "facts AS (SELECT ",
      items,
      " FROM (",
      input.source,
      `) m${teamJoin})`,
    );
  }
  const accountsParquet = input.files.accountsParquet;
  if (accountsParquet === undefined) {
    throw new Error(
      "compile called without accounts.parquet — caller must short-circuit",
    );
  }
  const accounts = buildAccountsSource(accountsParquet, input.scope.serverId);
  return seq(
    "WITH ",
    teamCte,
    "accounts AS (",
    accounts,
    "), facts AS (SELECT ",
    items,
    " FROM (",
    input.source,
    `) m JOIN accounts a ON a.puuid = m.puuid${teamJoin})`,
  );
}

export type CompiledEvidenceColumns =
  | { kind: "rate"; successes: string; trials: string }
  | { kind: "ratio"; numerator: string; denominator: string }
  | { kind: "sample"; sampleCount: string };

export type CompiledOutputColumn = {
  name: string;
  /** `expr_i`, or `__key_j` when the output echoes grouping j. */
  alias: string;
  evidence: CompiledEvidenceColumns;
};

export type CompiledPlanColumns = {
  label: "label";
  playerId: "player_id";
  discordId: "discord_id";
  /** `__key_i`, aligned with plan.groupings. */
  groupingKeys: string[];
  outputs: CompiledOutputColumn[];
};

export type AggregateTailInput = {
  plan: ScoutQlPlan;
  columns: ColumnMap;
  scope: LakeQueryScope;
  groupings: CompiledGrouping[];
  playerPuuids: Map<number, string[]> | undefined;
  /** The CTE the aggregate reads from — a compiler-owned name. */
  factsRelation: "facts" | "filtered";
  limit: number;
};

export type AggregateTail = {
  tail: SqlFragment;
  columns: CompiledPlanColumns;
};

function outputAliases(plan: ScoutQlPlan): Map<string, string> {
  const aliases = new Map<string, string>();
  plan.outputs.forEach((output, index) => {
    aliases.set(
      output.name,
      output.expr.kind === "grouping-ref"
        ? `__key_${output.expr.index.toString()}`
        : `expr_${index.toString()}`,
    );
  });
  return aliases;
}

function throwingResolver(name: string): SqlFragment {
  throw new Error(
    `Output reference "${name}" is only valid in HAVING or ORDER BY.`,
  );
}

/** Deduplicates identical select expressions and appends new ones. */
class SelectItemPool {
  private readonly aliasBySql = new Map<string, string>();
  readonly items: SqlFragment[] = [];

  /** Register an already-emitted item (an output) without re-appending it. */
  seed(fragment: SqlFragment, alias: string): void {
    this.aliasBySql.set(poolKey(fragment), alias);
  }

  /** Reuse the alias of an identical expression, or emit a new column. */
  add(fragment: SqlFragment, alias: string): string {
    const key = poolKey(fragment);
    const existing = this.aliasBySql.get(key);
    if (existing !== undefined) {
      return existing;
    }
    this.aliasBySql.set(key, alias);
    this.items.push(seq(fragment, ` AS ${alias}`));
    return alias;
  }
}

function poolKey(fragment: SqlFragment): string {
  return `${fragment.sql} ${JSON.stringify(fragment.params)}`;
}

function compileEvidence(
  plan: ScoutQlPlan,
  ctx: AggregateContext,
  pool: SelectItemPool,
): CompiledEvidenceColumns[] {
  return plan.outputs.map((output, index) => {
    const i = index.toString();
    return match(output.evidence)
      .with({ kind: "rate" }, (evidence): CompiledEvidenceColumns => ({
        kind: "rate",
        successes: pool.add(
          compileAggregateExpr(evidence.successes, ctx),
          `__succ_${i}`,
        ),
        trials: pool.add(
          compileAggregateExpr(evidence.trials, ctx),
          `__n_${i}`,
        ),
      }))
      .with({ kind: "ratio" }, (evidence): CompiledEvidenceColumns => ({
        kind: "ratio",
        numerator: pool.add(
          compileAggregateExpr(evidence.numerator, ctx),
          `__num_${i}`,
        ),
        denominator: pool.add(
          compileAggregateExpr(evidence.denominator, ctx),
          `__den_${i}`,
        ),
      }))
      .with({ kind: "sample" }, (): CompiledEvidenceColumns => ({
        kind: "sample",
        sampleCount: pool.add(frag("(COUNT(*))::BIGINT"), `__n_${i}`),
      }))
      .exhaustive();
  });
}

function identityColumns(
  scope: LakeQueryScope,
  groupings: CompiledGrouping[],
): { playerId: SqlFragment; discordId: SqlFragment } {
  const playerGrouped = groupings.some((grouping) => grouping.playerIdentity);
  if (playerGrouped && scope.kind === "guild") {
    return {
      playerId: frag("any_value(player_id) AS player_id"),
      discordId: frag("any_value(discord_id) AS discord_id"),
    };
  }
  return {
    playerId: frag("NULL::BIGINT AS player_id"),
    discordId: frag("NULL::VARCHAR AS discord_id"),
  };
}

function orderKeyAlias(
  plan: ScoutQlPlan,
  aliases: Map<string, string>,
  key: ScoutQlPlan["orderBy"][number],
): string {
  if (key.target.kind === "output") {
    const alias = aliases.get(key.target.name);
    if (alias === undefined) {
      throw new Error(`ORDER BY target "${key.target.name}" is not an output.`);
    }
    return alias;
  }
  if (key.target.index >= plan.groupings.length) {
    throw new Error("ORDER BY grouping index out of range.");
  }
  return `__key_${key.target.index.toString()}`;
}

/**
 * Deterministic ordering: every key gets explicit NULLS LAST, and `label ASC`
 * is appended as the final key unless the plan's single grouping is already an
 * order key (in which case the label is a function of an existing key).
 */
function orderByClause(
  plan: ScoutQlPlan,
  aliases: Map<string, string>,
): SqlFragment {
  const keys = plan.orderBy.map((key) => {
    const direction = match(key.direction)
      .with("asc", () => "ASC")
      .with("desc", () => "DESC")
      .exhaustive();
    return frag(`${orderKeyAlias(plan, aliases, key)} ${direction} NULLS LAST`);
  });
  const orderedBySingleGrouping =
    plan.groupings.length === 1 &&
    plan.orderBy.some((key) => {
      if (key.target.kind === "grouping") {
        return key.target.index === 0;
      }
      const output = plan.outputs.find(
        (candidate) =>
          key.target.kind === "output" && candidate.name === key.target.name,
      );
      return output?.expr.kind === "grouping-ref" && output.expr.index === 0;
    });
  if (!orderedBySingleGrouping) {
    keys.push(frag("label ASC NULLS LAST"));
  }
  return seq(" ORDER BY ", joinFragments(keys, ", "));
}

export function buildAggregateTail(input: AggregateTailInput): AggregateTail {
  const { plan, groupings } = input;
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("limit must be a positive integer.");
  }
  const aliases = outputAliases(plan);
  const outputContext: AggregateContext = {
    columns: input.columns,
    playerPuuids: input.playerPuuids,
    resolveOutputRef: throwingResolver,
  };
  const havingContext: AggregateContext = {
    columns: input.columns,
    playerPuuids: input.playerPuuids,
    resolveOutputRef: (name) => {
      const alias = aliases.get(name);
      if (alias === undefined) {
        throw new Error(`Unknown output "${name}" referenced by alias.`);
      }
      return frag(alias);
    },
  };

  const identity = identityColumns(input.scope, groupings);
  const keyItems = groupings.map((grouping, index) =>
    seq("(", grouping.key, `) AS __key_${index.toString()}`),
  );
  const pool = new SelectItemPool();
  const outputColumns: { alias: string; fragment: SqlFragment | undefined }[] =
    plan.outputs.map((output, index) => {
      if (output.expr.kind === "grouping-ref") {
        return {
          alias: `__key_${output.expr.index.toString()}`,
          fragment: undefined,
        };
      }
      // Every aggregate arm emits a self-delimited expression, so the
      // fragment is reused verbatim — keeping its text identical to any
      // evidence companion compiled from the same IR (pool dedupe).
      const compiled = compileAggregateExpr(output.expr, outputContext);
      const alias = `expr_${index.toString()}`;
      pool.seed(compiled, alias);
      return { alias, fragment: seq(compiled, ` AS ${alias}`) };
    });
  const evidence = compileEvidence(plan, outputContext, pool);

  // Keys come first: label expressions reference them as lateral aliases
  // (`strftime(__key_0, …)`), which DuckDB resolves against the earlier item.
  const selectItems = [
    ...keyItems,
    seq(
      groupingLabelJoin(
        groupings.map((grouping, index) =>
          grouping.label(`__key_${index.toString()}`),
        ),
      ),
      " AS label",
    ),
    identity.playerId,
    identity.discordId,
    ...outputColumns.flatMap((output) =>
      output.fragment === undefined ? [] : [output.fragment],
    ),
    ...pool.items,
  ];

  const groupBy =
    groupings.length === 0
      ? frag("")
      : frag(
          ` GROUP BY ${groupings.map((_, index) => `__key_${index.toString()}`).join(", ")}`,
        );
  const havingConjuncts: SqlFragment[] = [];
  if (plan.having !== undefined) {
    havingConjuncts.push(compileHavingPredicate(plan.having, havingContext));
  }
  if (groupings.length === 0) {
    // Whole-table aggregate: without this, an empty facts CTE still yields
    // one row of zero-counts. Mirrors the legacy compiler.
    havingConjuncts.push(frag("COUNT(*) > 0"));
  }
  const having = combineAnd(havingConjuncts);

  const tail = seq(
    "SELECT ",
    joinFragments(selectItems, ", "),
    ` FROM ${input.factsRelation}`,
    groupBy,
    having.sql.length === 0 ? frag("") : seq(" HAVING ", having),
    orderByClause(plan, aliases),
    " LIMIT ?",
    frag("", [scalarParam(input.limit)]),
  );

  return {
    tail,
    columns: {
      label: "label",
      playerId: "player_id",
      discordId: "discord_id",
      groupingKeys: groupings.map((_, index) => `__key_${index.toString()}`),
      outputs: plan.outputs.map((output, index) => {
        const column = outputColumns[index];
        const evidenceColumns = evidence[index];
        if (column === undefined || evidenceColumns === undefined) {
          throw new Error("unreachable: output column arity mismatch");
        }
        return {
          name: output.name,
          alias: column.alias,
          evidence: evidenceColumns,
        };
      }),
    },
  };
}
