import { match } from "ts-pattern";
import type { ScoutQlGrouping } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ScoutQlScalarExpr } from "@scout-for-lol/data/model/scoutql/expression.ts";
import { scalarParam } from "#src/reports/duckdb/lake.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import type { LakeQueryScope } from "#src/reports/duckdb/scope.ts";
import {
  collectScalarColumnNames,
  compileScalarExpr,
  resolveColumn,
  walkScalarExpr,
  type ColumnMap,
  type PlanColumnSource,
} from "#src/reports/duckdb/expr-sql.ts";
import { frag, joinFragments, seq } from "#src/reports/duckdb/sql-fragment.ts";

/**
 * Grouping arms for the ScoutQL v2 plan compiler, replicating the legacy
 * compile-grouping.ts labeling exactly:
 *
 * - guild `player` groups by player_id and labels with any_value(player_alias);
 *   global `player` groups by puuid and labels with the MOST RECENT Riot ID
 *   (arg_max over the time column), because a Riot ID is a display name that
 *   changes and any_value would let two runs of one query disagree.
 * - `champion` keys champion_id (prematch rows have no champion_name and show
 *   the id), `patch` extracts major.minor from game_version, `outcome` keys
 *   the win flag, `arena_placement` keys the nullable placement.
 *
 * Each grouping emits one typed key (`__key_i`) plus a VARCHAR label
 * contribution; multi-grouping labels join with ' • ' exactly as before.
 */

export type CompiledGrouping = {
  /** Typed grouping key expression (facts context) — becomes `__key_i`. */
  key: SqlFragment;
  /**
   * VARCHAR label contribution, as a function of the key's SELECT alias.
   * Labels reference the key laterally (`strftime(__key_0, …)`) rather than
   * repeating its expression: a repeated expression would re-bind its `?`
   * parameters under new indexes, and DuckDB's binder would then refuse to
   * treat it as the same GROUP BY expression.
   */
  label: (keyRef: string) => SqlFragment;
  /** Groups player identity — drives the hidden player_id/discord_id columns. */
  playerIdentity: boolean;
  /** Column names this grouping references (grow the facts projection). */
  columnNames: string[];
};

export type GroupingInput = {
  grouping: ScoutQlGrouping;
  columns: ColumnMap;
  scope: LakeQueryScope;
  source: PlanColumnSource;
  timeColumn: "game_creation_at" | "observed_at";
  playerPuuids: Map<number, string[]> | undefined;
};

function requireColumns(columns: ColumnMap, names: string[]): void {
  for (const name of names) {
    resolveColumn(columns, name);
  }
}

function playerGrouping(input: GroupingInput): CompiledGrouping {
  if (input.scope.kind === "global") {
    return {
      key: frag("puuid"),
      label: () => frag(`arg_max(player_alias, ${input.timeColumn})`),
      playerIdentity: true,
      columnNames: ["puuid"],
    };
  }
  return {
    key: frag("player_id"),
    label: () => frag("any_value(player_alias)"),
    playerIdentity: true,
    columnNames: [],
  };
}

function championGrouping(input: GroupingInput): CompiledGrouping {
  return match(input.source)
    .with("match", (): CompiledGrouping => {
      requireColumns(input.columns, ["champion_id", "champion_name"]);
      return {
        key: frag("champion_id"),
        label: () => frag("any_value(champion_name)"),
        playerIdentity: false,
        columnNames: ["champion_id", "champion_name"],
      };
    })
    .with("prematch", (): CompiledGrouping => {
      requireColumns(input.columns, ["champion_id"]);
      return {
        key: frag("champion_id"),
        label: (keyRef) => frag(`(${keyRef})::VARCHAR`),
        playerIdentity: false,
        columnNames: ["champion_id"],
      };
    })
    .exhaustive();
}

function nullableTextGrouping(
  column: string,
  input: GroupingInput,
): CompiledGrouping {
  requireColumns(input.columns, [column]);
  return {
    key: frag(`coalesce(${column}, 'unknown')`),
    label: (keyRef) => frag(keyRef),
    playerIdentity: false,
    columnNames: [column],
  };
}

function compileColumnGrouping(
  name: string,
  input: GroupingInput,
): CompiledGrouping {
  return match(name)
    .with("player", () => playerGrouping(input))
    .with("champion", () => championGrouping(input))
    .with(
      "queue",
      "team_position",
      "individual_position",
      "lane",
      "role",
      "game_mode",
      "game_type",
      (column) => nullableTextGrouping(column, input),
    )
    .with("patch", (): CompiledGrouping => {
      requireColumns(input.columns, ["game_version"]);
      return {
        key: frag(String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`),
        label: (keyRef) => frag(keyRef),
        playerIdentity: false,
        columnNames: ["game_version"],
      };
    })
    .with("outcome", (): CompiledGrouping => {
      requireColumns(input.columns, ["win"]);
      return {
        key: frag("win"),
        label: (keyRef) =>
          frag(`CASE WHEN ${keyRef} THEN 'Win' ELSE 'Loss' END`),
        playerIdentity: false,
        columnNames: ["win"],
      };
    })
    .with("surrender_state", (): CompiledGrouping => {
      requireColumns(input.columns, ["early_surrendered", "surrendered"]);
      return {
        key: frag(
          "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END",
        ),
        label: (keyRef) => frag(keyRef),
        playerIdentity: false,
        columnNames: ["early_surrendered", "surrendered"],
      };
    })
    .with("arena_placement", (): CompiledGrouping => {
      requireColumns(input.columns, ["placement"]);
      return {
        key: frag("placement"),
        label: (keyRef) => frag(`coalesce((${keyRef})::VARCHAR, 'Not Arena')`),
        playerIdentity: false,
        columnNames: ["placement"],
      };
    })
    .with("map", (): CompiledGrouping => {
      requireColumns(input.columns, ["map_id"]);
      return {
        key: frag("map_id"),
        label: (keyRef) => frag(`(${keyRef})::VARCHAR`),
        playerIdentity: false,
        columnNames: ["map_id"],
      };
    })
    .otherwise((): CompiledGrouping => {
      const binding = resolveColumn(input.columns, name);
      if (binding.identity) {
        throw new Error(`Cannot group by identity column "${name}".`);
      }
      return {
        key: frag(`(${binding.sql})`),
        label: (keyRef) => frag(`coalesce((${keyRef})::VARCHAR, 'unknown')`),
        playerIdentity: false,
        columnNames: [...binding.dependencies],
      };
    });
}

function containsNow(expr: ScoutQlScalarExpr): boolean {
  let found = false;
  walkScalarExpr(expr, (node) => {
    if (node.kind === "now") {
      found = true;
    }
  });
  return found;
}

/**
 * A GROUP BY expression must be a deterministic FLOOR-based numeric bucket:
 * `FLOOR(x / w)`, `FLOOR(x / w) * w`, or `w * FLOOR(x / w)`. Validated
 * structurally — no attempt to prove arbitrary determinism, just the closed
 * bucketing shapes plus a ban on `now`.
 */
function validateBucketExpression(expr: ScoutQlScalarExpr): void {
  if (containsNow(expr)) {
    throw new Error(
      "GROUP BY expressions must not reference the current time.",
    );
  }
  const isFloorCall = (candidate: ScoutQlScalarExpr): boolean =>
    candidate.kind === "scalar-call" && candidate.func === "floor";
  if (isFloorCall(expr)) {
    return;
  }
  if (
    expr.kind === "arithmetic" &&
    expr.op === "*" &&
    ((isFloorCall(expr.left) && expr.right.kind === "literal") ||
      (isFloorCall(expr.right) && expr.left.kind === "literal"))
  ) {
    return;
  }
  throw new Error(
    "GROUP BY expressions are limited to FLOOR-based numeric buckets like FLOOR(x / w) * w.",
  );
}

const DATE_TRUNC_LABEL_FORMAT = {
  day: "%Y-%m-%d",
  week: "%Y-%m-%d",
  month: "%Y-%m",
} as const;

function compileDateTruncGrouping(
  grouping: {
    part: "day" | "week" | "month";
    column: string;
    timezone: string;
  },
  input: GroupingInput,
): CompiledGrouping {
  const binding = resolveColumn(input.columns, grouping.column);
  if (binding.type !== "timestamp") {
    throw new Error(
      `DATE_TRUNC requires a timestamp column; "${grouping.column}" is ${binding.type}.`,
    );
  }
  const part = match(grouping.part)
    .with("day", () => "day")
    .with("week", () => "week")
    .with("month", () => "month")
    .exhaustive();
  // Interpret the naive-UTC timestamp as an instant, render it in the bound
  // zone, then truncate — the double-timezone form the legacy compiler used.
  const key = seq(
    `date_trunc('${part}', timezone(?, timezone('UTC', (`,
    frag("", [scalarParam(grouping.timezone)]),
    binding.sql,
    "))))",
  );
  return {
    key,
    label: (keyRef) =>
      frag(`strftime(${keyRef}, '${DATE_TRUNC_LABEL_FORMAT[grouping.part]}')`),
    playerIdentity: false,
    columnNames: [grouping.column],
  };
}

export function compilePlanGrouping(input: GroupingInput): CompiledGrouping {
  return match(input.grouping)
    .with({ kind: "column" }, (grouping) =>
      compileColumnGrouping(grouping.column, input),
    )
    .with({ kind: "date-trunc" }, (grouping) =>
      compileDateTruncGrouping(grouping, input),
    )
    .with({ kind: "expression" }, (grouping) => {
      validateBucketExpression(grouping.expr);
      const compiled = compileScalarExpr(grouping.expr, {
        columns: input.columns,
        placement: "facts",
        playerPuuids: input.playerPuuids,
      });
      const referenced = new Set<string>();
      collectScalarColumnNames(grouping.expr, referenced);
      return {
        key: compiled,
        label: (keyRef: string) =>
          frag(`coalesce((${keyRef})::VARCHAR, 'unknown')`),
        playerIdentity: false,
        columnNames: [...referenced],
      };
    })
    .with({ kind: "group" }, () => {
      throw new Error(
        "group(...) groupings compile through compileGroupFactsProjection.",
      );
    })
    .exhaustive();
}

/** Join per-grouping label contributions into the hidden `label` column. */
export function groupingLabelJoin(labels: SqlFragment[]): SqlFragment {
  if (labels.length === 0) {
    return frag("'All'");
  }
  if (labels.length === 1) {
    const only = labels[0];
    if (only === undefined) {
      throw new Error("unreachable: single-label list has no head");
    }
    return only;
  }
  return seq("concat_ws(' • ', ", joinFragments(labels, ", "), ")");
}
