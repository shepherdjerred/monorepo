import { match } from "ts-pattern";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import { listParam, scalarParam } from "#src/reports/duckdb/lake.ts";
import {
  resolveColumn,
  type ColumnMap,
} from "#src/reports/duckdb/column-map.ts";
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
 *
 * The vocabulary itself — which names exist and what SQL each becomes — lives
 * in column-map.ts; this file only translates expressions against it.
 */

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

/** Whether every column a predicate reads is one of `names`. */
export function predicateReadsOnly(
  pred: ScoutQlPredicate,
  names: ReadonlySet<string>,
): boolean {
  const referenced = new Set<string>();
  collectPredicateColumnNames(pred, referenced);
  return [...referenced].every((name) => names.has(name));
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
