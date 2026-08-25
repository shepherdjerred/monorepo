import { match } from "ts-pattern";
import {
  MATCH_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "@scout-for-lol/data/model/lake-columns.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import { listParam, scalarParam } from "#src/reports/duckdb/lake.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import {
  emitArithmetic,
  emitScalarCall,
  frag,
  joinFragments,
  seq,
} from "#src/reports/duckdb/sql-fragment.ts";

/**
 * ScoutQL v2 scalar-expression and predicate compiler.
 *
 * Column identifiers resolve ONLY against a ColumnMap built from the closed
 * lake-schema maps plus the engine's virtual dimension columns — an unknown
 * name throws before any SQL exists. Every literal, IN list, timezone, and
 * interval amount travels as a bound parameter; the only SQL text emitted here
 * is selected by exhaustive matches over the closed IR enums.
 */

export type SqlTypeClass =
  "numeric" | "boolean" | "text" | "timestamp" | "date" | "interval";

export type ColumnBinding = {
  /** SQL over bare source-column names (valid in union branches and facts). */
  sql: string;
  type: SqlTypeClass;
  /** Source columns this expression reads (grown into the facts projection). */
  dependencies: readonly string[];
  /** Identity columns exist only after the facts projection, never in a
   * union-branch pushdown context. */
  identity: boolean;
};

export type ColumnMap = ReadonlyMap<string, ColumnBinding>;

export type PlanColumnSource = "match" | "prematch";

const LAKE_TYPE_CLASS: Record<DuckDbColumnType, SqlTypeClass> = {
  VARCHAR: "text",
  INTEGER: "numeric",
  BIGINT: "numeric",
  DOUBLE: "numeric",
  BOOLEAN: "boolean",
  TIMESTAMP: "timestamp",
};

function sourceColumnEntries(
  columns: Record<string, DuckDbColumnType>,
): [string, ColumnBinding][] {
  return Object.entries(columns).map(([name, type]) => [
    name,
    {
      sql: name,
      type: LAKE_TYPE_CLASS[type],
      dependencies: [name],
      identity: false,
    },
  ]);
}

function virtual(
  sql: string,
  type: SqlTypeClass,
  dependencies: string[],
): ColumnBinding {
  return { sql, type, dependencies, identity: false };
}

const PLAYER_BINDING: ColumnBinding = {
  sql: "player_alias",
  type: "text",
  dependencies: [],
  identity: true,
};

const SURRENDER_STATE_SQL =
  "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END";

/** Virtual dimensions over match facts, mirroring the grouping arms. */
const MATCH_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  ["champion", virtual("champion_name", "text", ["champion_name"])],
  [
    "patch",
    virtual(
      String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`,
      "text",
      ["game_version"],
    ),
  ],
  [
    "outcome",
    virtual("CASE WHEN win THEN 'Win' ELSE 'Loss' END", "text", ["win"]),
  ],
  [
    "surrender_state",
    virtual(SURRENDER_STATE_SQL, "text", ["early_surrendered", "surrendered"]),
  ],
  [
    "arena_placement",
    virtual("coalesce(placement::VARCHAR, 'Not Arena')", "text", ["placement"]),
  ],
  ["map", virtual("map_id", "numeric", ["map_id"])],
];

/** Prematch rows have no champion_name; the dimension shows the numeric id. */
const PREMATCH_VIRTUAL_COLUMNS: [string, ColumnBinding][] = [
  ["player", PLAYER_BINDING],
  ["champion", virtual("champion_id::VARCHAR", "text", ["champion_id"])],
  ["map", virtual("map_id", "numeric", ["map_id"])],
];

export function buildPlanColumnMap(source: PlanColumnSource): ColumnMap {
  return match(source)
    .with(
      "match",
      () =>
        new Map([
          ...sourceColumnEntries(MATCH_LAKE_COLUMNS),
          ...MATCH_VIRTUAL_COLUMNS,
        ]),
    )
    .with(
      "prematch",
      () =>
        new Map([
          ...sourceColumnEntries(PREMATCH_LAKE_COLUMNS),
          ...PREMATCH_VIRTUAL_COLUMNS,
        ]),
    )
    .exhaustive();
}

export function resolveColumn(columns: ColumnMap, name: string): ColumnBinding {
  const binding = columns.get(name);
  if (binding === undefined) {
    throw new Error(`Unknown column "${name}" for this source.`);
  }
  return binding;
}

export type ExprContext = {
  columns: ColumnMap;
  /**
   * "source": the predicate is pushed into the parquet/staging union branches,
   * where identity columns do not exist yet. "facts": over the facts CTE,
   * which projects identity and every referenced source column bare.
   */
  placement: "source" | "facts";
  /** Resolved `player('…')` PUUIDs by playerRefs index. */
  playerPuuids: Map<number, string[]> | undefined;
};

const INTERVAL_CONSTRUCTOR = {
  second: "to_seconds",
  minute: "to_minutes",
  hour: "to_hours",
  day: "to_days",
  week: "to_weeks",
  month: "to_months",
  year: "to_years",
} as const;

const CAST_TYPE = {
  int: "INTEGER",
  bigint: "BIGINT",
  double: "DOUBLE",
  date: "DATE",
  timestamp: "TIMESTAMP",
  varchar: "VARCHAR",
} as const;

export function compileScalarExpr(
  expr: ScoutQlScalarExpr,
  ctx: ExprContext,
): SqlFragment {
  return (
    match(expr)
      .with({ kind: "column" }, (node) => {
        const binding = resolveColumn(ctx.columns, node.column);
        if (binding.identity && ctx.placement === "source") {
          throw new Error(
            `Column "${node.column}" is an identity column and cannot be pushed into the source scan.`,
          );
        }
        return frag(binding.sql);
      })
      .with({ kind: "literal" }, (node) => frag("?", [scalarParam(node.value)]))
      .with({ kind: "interval" }, (node) => {
        if (!Number.isInteger(node.amount) || node.amount <= 0) {
          throw new TypeError("INTERVAL amount must be a positive integer.");
        }
        return frag(`${INTERVAL_CONSTRUCTOR[node.unit]}(?::INTEGER)`, [
          scalarParam(node.amount),
        ]);
      })
      .with({ kind: "now" }, (node) =>
        // Lake timestamps are naive UTC; timezone('UTC', now()) is the current
        // instant in that same shape, independent of DuckDB's session zone.
        node.which === "timestamp"
          ? frag("timezone('UTC', now())")
          : frag("CAST(timezone('UTC', now()) AS DATE)"),
      )
      .with({ kind: "negate" }, (node) =>
        seq("(-(", compileScalarExpr(node.operand, ctx), "))"),
      )
      .with({ kind: "arithmetic" }, (node) =>
        emitArithmetic(
          node.op,
          compileScalarExpr(node.left, ctx),
          compileScalarExpr(node.right, ctx),
        ),
      )
      .with({ kind: "at-time-zone" }, (node) =>
        // Interpret the naive-UTC operand as an instant, then render its wall
        // time in the bound zone (still naive, so ::DATE and date_trunc work).
        seq(
          "timezone(?, timezone('UTC', (",
          frag("", [scalarParam(node.timezone)]),
          compileScalarExpr(node.operand, ctx),
          ")))",
        ),
      )
      .with({ kind: "cast" }, (node) =>
        seq(
          "((",
          compileScalarExpr(node.operand, ctx),
          `))::${CAST_TYPE[node.to]}`,
        ),
      )
      .with({ kind: "scalar-call" }, (node) =>
        emitScalarCall(
          node.func,
          node.args.map((arg) => ({
            fragment: compileScalarExpr(arg, ctx),
            literal: arg.kind === "literal" ? arg.value : undefined,
          })),
        ),
      )
      // A predicate used as a value: `AVG((placement <= 2)::INT)`. SQL has no
      // separate condition type, so the predicate compiler serves both
      // positions; the parens keep it a single operand for any enclosing cast.
      .with({ kind: "predicate" }, (node) =>
        seq("(", compilePredicate(node.predicate, ctx), ")"),
      )
      .exhaustive()
  );
}

function compileInPredicate(
  pred: {
    operand: ScoutQlScalarExpr;
    negated: boolean;
    items: (number | string)[];
  },
  ctx: ExprContext,
): SqlFragment {
  const strings: string[] = [];
  const numbers: number[] = [];
  for (const item of pred.items) {
    if (typeof item === "string") {
      strings.push(item);
    } else {
      numbers.push(item);
    }
  }
  if (strings.length > 0 && numbers.length > 0) {
    throw new Error("IN list items must be all strings or all numbers.");
  }
  if (strings.length === 0 && numbers.length === 0) {
    throw new Error("IN list must not be empty.");
  }
  const list = strings.length > 0 ? listParam(strings) : listParam(numbers);
  const operator = pred.negated ? "NOT IN" : "IN";
  return seq(
    "((",
    compileScalarExpr(pred.operand, ctx),
    `) ${operator} (SELECT unnest(?)))`,
    frag("", [list]),
  );
}

function compilePlayerRef(index: number, ctx: ExprContext): SqlFragment {
  if (ctx.playerPuuids === undefined) {
    throw new Error(
      "player('…') requires resolved PUUIDs; the executor must supply playerPuuids.",
    );
  }
  const puuids = ctx.playerPuuids.get(index);
  if (puuids === undefined || puuids.length === 0) {
    throw new Error(
      `player('…') reference ${index.toString()} resolved to no accounts.`,
    );
  }
  // Compared exactly, with no lower() on either side: PUUIDs are
  // case-sensitive base64url, so folding them would be a semantic lie.
  return frag("(puuid IN (SELECT unnest(?)))", [listParam(puuids)]);
}

const COMPARE_OPERATOR = {
  "=": "=",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  like: "LIKE",
  ilike: "ILIKE",
} as const;

export function compilePredicate(
  pred: ScoutQlPredicate,
  ctx: ExprContext,
): SqlFragment {
  return match(pred)
    .with({ kind: "and" }, { kind: "or" }, (node) =>
      seq(
        "(",
        joinFragments(
          node.operands.map((operand) => compilePredicate(operand, ctx)),
          node.kind === "and" ? " AND " : " OR ",
        ),
        ")",
      ),
    )
    .with({ kind: "not" }, (node) =>
      seq("(NOT ", compilePredicate(node.operand, ctx), ")"),
    )
    .with({ kind: "compare" }, (node) =>
      seq(
        "((",
        compileScalarExpr(node.left, ctx),
        `) ${COMPARE_OPERATOR[node.op]} (`,
        compileScalarExpr(node.right, ctx),
        "))",
      ),
    )
    .with({ kind: "in" }, (node) => compileInPredicate(node, ctx))
    .with({ kind: "between" }, (node) =>
      seq(
        "((",
        compileScalarExpr(node.operand, ctx),
        `) ${node.negated ? "NOT BETWEEN" : "BETWEEN"} (`,
        compileScalarExpr(node.low, ctx),
        ") AND (",
        compileScalarExpr(node.high, ctx),
        "))",
      ),
    )
    .with({ kind: "is-null" }, (node) =>
      seq(
        "((",
        compileScalarExpr(node.operand, ctx),
        `) IS ${node.negated ? "NOT NULL" : "NULL"})`,
      ),
    )
    .with({ kind: "player-ref" }, (node) => compilePlayerRef(node.index, ctx))
    .exhaustive();
}

export type PredicateWalkNode = ScoutQlPredicate | ScoutQlScalarExpr;

/** Visit every node of a scalar expression tree (pre-order). */
export function walkScalarExpr(
  expr: ScoutQlScalarExpr,
  // The union, not just scalars: a scalar tree can contain a predicate used
  // as a value, and callers that collect referenced columns must see through
  // it — a column named only inside `(placement <= 2)` still has to reach the
  // facts projection.
  visit: (node: PredicateWalkNode) => void,
): void {
  visit(expr);
  match(expr)
    .with(
      { kind: "column" },
      { kind: "literal" },
      { kind: "interval" },
      { kind: "now" },
      () => {
        // Leaf.
      },
    )
    .with(
      { kind: "negate" },
      { kind: "at-time-zone" },
      { kind: "cast" },
      (node) => {
        walkScalarExpr(node.operand, visit);
      },
    )
    .with({ kind: "arithmetic" }, (node) => {
      walkScalarExpr(node.left, visit);
      walkScalarExpr(node.right, visit);
    })
    .with({ kind: "scalar-call" }, (node) => {
      for (const arg of node.args) {
        walkScalarExpr(arg, visit);
      }
    })
    .with({ kind: "predicate" }, (node) => {
      walkPredicate(node.predicate, visit);
    })
    .exhaustive();
}

/** Visit every predicate node and every scalar node under it (pre-order). */
export function walkPredicate(
  pred: ScoutQlPredicate,
  visit: (node: PredicateWalkNode) => void,
): void {
  visit(pred);
  match(pred)
    .with({ kind: "and" }, { kind: "or" }, (node) => {
      for (const operand of node.operands) {
        walkPredicate(operand, visit);
      }
    })
    .with({ kind: "not" }, (node) => {
      walkPredicate(node.operand, visit);
    })
    .with({ kind: "compare" }, (node) => {
      walkScalarExpr(node.left, visit);
      walkScalarExpr(node.right, visit);
    })
    .with({ kind: "in" }, { kind: "is-null" }, (node) => {
      walkScalarExpr(node.operand, visit);
    })
    .with({ kind: "between" }, (node) => {
      walkScalarExpr(node.operand, visit);
      walkScalarExpr(node.low, visit);
      walkScalarExpr(node.high, visit);
    })
    .with({ kind: "player-ref" }, () => {
      // Leaf; references puuid implicitly.
    })
    .exhaustive();
}

export function countScalarNodes(expr: ScoutQlScalarExpr): number {
  let count = 0;
  walkScalarExpr(expr, () => {
    count += 1;
  });
  return count;
}

export function countPredicateNodes(pred: ScoutQlPredicate): number {
  let count = 0;
  walkPredicate(pred, () => {
    count += 1;
  });
  return count;
}

/** Record the column names a walked node references. */
export function recordColumnNames(
  node: PredicateWalkNode,
  into: Set<string>,
): void {
  if (node.kind === "column") {
    into.add(node.column);
  }
  if (node.kind === "player-ref") {
    into.add("puuid");
  }
}

export function collectScalarColumnNames(
  expr: ScoutQlScalarExpr,
  into: Set<string>,
): void {
  walkScalarExpr(expr, (node) => {
    recordColumnNames(node, into);
  });
}

export function collectPredicateColumnNames(
  pred: ScoutQlPredicate,
  into: Set<string>,
): void {
  walkPredicate(pred, (node) => {
    recordColumnNames(node, into);
  });
}

/**
 * Whether a predicate touches any identity column. Identity-touching conjuncts
 * cannot be pushed into the union branches — identity exists only after the
 * accounts join (guild) or the facts projection (global).
 */
export function predicateTouchesIdentity(
  pred: ScoutQlPredicate,
  columns: ColumnMap,
): boolean {
  const referenced = new Set<string>();
  collectPredicateColumnNames(pred, referenced);
  for (const name of referenced) {
    if (resolveColumn(columns, name).identity) {
      return true;
    }
  }
  return false;
}
