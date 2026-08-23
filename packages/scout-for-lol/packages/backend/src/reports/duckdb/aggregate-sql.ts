import { match } from "ts-pattern";
import type {
  ScoutQlAggregateExpr,
  ScoutQlHavingPredicate,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import { scalarParam } from "#src/reports/duckdb/lake.ts";
import type { SqlFragment } from "#src/reports/duckdb/lake.ts";
import {
  compilePredicate,
  compileScalarExpr,
  recordColumnNames,
  resolveColumn,
  walkPredicate,
  walkScalarExpr,
  type ColumnMap,
  type ExprContext,
  type PredicateWalkNode,
  type SqlTypeClass,
} from "#src/reports/duckdb/expr-sql.ts";
import {
  EMPTY_FRAGMENT,
  emitArithmetic,
  emitScalarCall,
  frag,
  seq,
} from "#src/reports/duckdb/sql-fragment.ts";

/**
 * ScoutQL v2 aggregate-expression compiler: SELECT outputs, HAVING, and the
 * evidence companions all flow through here. FILTER clauses reuse the shared
 * predicate compiler against the facts CTE.
 *
 * Cast policy (row-shape stability): count-family aggregates cast ::BIGINT;
 * SUM/AVG/STDDEV cast ::DOUBLE; MIN/MAX/MEDIAN/QUANTILE_CONT cast ::DOUBLE
 * only when their argument is statically numeric (a text or timestamp
 * argument keeps its own type). Division always guards its denominator with
 * nullif(…, 0).
 */

export type AggregateContext = {
  columns: ColumnMap;
  playerPuuids: Map<number, string[]> | undefined;
  /**
   * Resolve an `output-ref` to the positional SQL alias of the referenced
   * output (`expr_i` / `__key_i`). Output expressions themselves get a
   * throwing resolver: alias references are legal only in HAVING / ORDER BY.
   */
  resolveOutputRef: (name: string) => SqlFragment;
};

/** Infer the static type class of a scalar expression for cast decisions. */
export function inferScalarType(
  expr: ScoutQlScalarExpr,
  columns: ColumnMap,
): SqlTypeClass {
  return match(expr)
    .with(
      { kind: "column" },
      (node) => resolveColumn(columns, node.column).type,
    )
    .with({ kind: "literal" }, (node) =>
      match(typeof node.value)
        .with("number", (): SqlTypeClass => "numeric")
        .with("boolean", (): SqlTypeClass => "boolean")
        .otherwise((): SqlTypeClass => "text"),
    )
    .with({ kind: "interval" }, (): SqlTypeClass => "interval")
    .with({ kind: "now" }, (node): SqlTypeClass =>
      node.which === "timestamp" ? "timestamp" : "date",
    )
    .with({ kind: "negate" }, (): SqlTypeClass => "numeric")
    .with({ kind: "arithmetic" }, (node): SqlTypeClass => {
      const left = inferScalarType(node.left, columns);
      const right = inferScalarType(node.right, columns);
      if (left === "timestamp" || left === "date") return left;
      if (right === "timestamp" || right === "date") return right;
      return "numeric";
    })
    .with({ kind: "at-time-zone" }, (): SqlTypeClass => "timestamp")
    .with({ kind: "cast" }, (node): SqlTypeClass =>
      match(node.to)
        .with("int", "bigint", "double", (): SqlTypeClass => "numeric")
        .with("date", (): SqlTypeClass => "date")
        .with("timestamp", (): SqlTypeClass => "timestamp")
        .with("varchar", (): SqlTypeClass => "text")
        .exhaustive(),
    )
    .with({ kind: "scalar-call" }, (node): SqlTypeClass =>
      match(node.func)
        .with("round", "floor", "ceil", "abs", (): SqlTypeClass => "numeric")
        .with("date_trunc", (): SqlTypeClass => "timestamp")
        .with("coalesce", "nullif", "greatest", "least", (): SqlTypeClass => {
          const head = node.args[0];
          if (head === undefined) {
            throw new Error(`${node.func}() requires at least one argument.`);
          }
          return inferScalarType(head, columns);
        })
        .exhaustive(),
    )
    .exhaustive();
}

function scalarContext(ctx: AggregateContext): ExprContext {
  return {
    columns: ctx.columns,
    placement: "facts",
    playerPuuids: ctx.playerPuuids,
  };
}

function filterSuffix(
  filter: ScoutQlPredicate | undefined,
  ctx: AggregateContext,
): SqlFragment {
  if (filter === undefined) {
    return EMPTY_FRAGMENT;
  }
  return seq(
    " FILTER (WHERE ",
    compilePredicate(filter, scalarContext(ctx)),
    ")",
  );
}

function numericCastSuffix(
  arg: ScoutQlScalarExpr,
  ctx: AggregateContext,
): string {
  const argType = inferScalarType(arg, ctx.columns);
  return argType === "numeric" ? "::DOUBLE" : "";
}

function compileFunctionAggregate(
  node: {
    func: "count" | "sum" | "avg" | "min" | "max" | "median" | "stddev";
    arg: ScoutQlScalarExpr;
    distinct: boolean;
    filter?: ScoutQlPredicate | undefined;
  },
  ctx: AggregateContext,
): SqlFragment {
  if (node.distinct && node.func !== "count") {
    throw new Error(
      `DISTINCT is only supported for COUNT, not ${node.func.toUpperCase()}.`,
    );
  }
  const arg = compileScalarExpr(node.arg, scalarContext(ctx));
  const distinct = node.distinct ? "DISTINCT " : "";
  const filter = filterSuffix(node.filter, ctx);
  return match(node.func)
    .with("count", () =>
      seq("(COUNT(", distinct, "(", arg, "))", filter, ")::BIGINT"),
    )
    .with("sum", "avg", "stddev", (func) =>
      seq(`(${func.toUpperCase()}((`, arg, "))", filter, ")::DOUBLE"),
    )
    .with("min", "max", "median", (func) =>
      seq(
        `(${func.toUpperCase()}((`,
        arg,
        "))",
        filter,
        `)${numericCastSuffix(node.arg, ctx)}`,
      ),
    )
    .exhaustive();
}

export function compileAggregateExpr(
  expr: ScoutQlAggregateExpr,
  ctx: AggregateContext,
): SqlFragment {
  return match(expr)
    .with({ kind: "count-star" }, (node) =>
      seq("(COUNT(*)", filterSuffix(node.filter, ctx), ")::BIGINT"),
    )
    .with({ kind: "aggregate" }, (node) => compileFunctionAggregate(node, ctx))
    .with({ kind: "quantile" }, (node) => {
      if (!(node.q > 0 && node.q < 1)) {
        throw new Error(
          "QUANTILE_CONT fraction must be between 0 and 1 exclusive.",
        );
      }
      return seq(
        "(QUANTILE_CONT((",
        compileScalarExpr(node.arg, scalarContext(ctx)),
        "), ?)",
        frag("", [scalarParam(node.q)]),
        filterSuffix(node.filter, ctx),
        `)${numericCastSuffix(node.arg, ctx)}`,
      );
    })
    .with({ kind: "literal" }, (node) =>
      frag("(?::DOUBLE)", [scalarParam(node.value)]),
    )
    .with({ kind: "arithmetic" }, (node) =>
      emitArithmetic(
        node.op,
        compileAggregateExpr(node.left, ctx),
        compileAggregateExpr(node.right, ctx),
      ),
    )
    .with({ kind: "scalar-call" }, (node) =>
      emitScalarCall(
        node.func,
        node.args.map((arg) => ({
          fragment: compileAggregateExpr(arg, ctx),
          literal: arg.kind === "literal" ? arg.value : undefined,
        })),
      ),
    )
    .with({ kind: "output-ref" }, (node) => ctx.resolveOutputRef(node.name))
    .exhaustive();
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

export function compileHavingPredicate(
  having: ScoutQlHavingPredicate,
  ctx: AggregateContext,
): SqlFragment {
  return match(having)
    .with({ kind: "and" }, { kind: "or" }, (node) => {
      const joiner = node.kind === "and" ? " AND " : " OR ";
      const parts = node.operands.map((operand) =>
        compileHavingPredicate(operand, ctx),
      );
      const joined = parts.flatMap((part, index) =>
        index === 0 ? [part] : [frag(joiner), part],
      );
      return seq("(", ...joined, ")");
    })
    .with({ kind: "not" }, (node) =>
      seq("(NOT ", compileHavingPredicate(node.operand, ctx), ")"),
    )
    .with({ kind: "compare" }, (node) =>
      seq(
        "((",
        compileAggregateExpr(node.left, ctx),
        `) ${COMPARE_OPERATOR[node.op]} (`,
        compileAggregateExpr(node.right, ctx),
        "))",
      ),
    )
    .exhaustive();
}

export type AggregateWalkNode = ScoutQlAggregateExpr | PredicateWalkNode;

/** Visit every aggregate node plus every filter/argument node under it. */
export function walkAggregateExpr(
  expr: ScoutQlAggregateExpr,
  visit: (node: AggregateWalkNode) => void,
): void {
  visit(expr);
  match(expr)
    .with({ kind: "count-star" }, (node) => {
      if (node.filter !== undefined) {
        walkPredicate(node.filter, visit);
      }
    })
    .with({ kind: "aggregate" }, { kind: "quantile" }, (node) => {
      walkScalarExpr(node.arg, visit);
      if (node.filter !== undefined) {
        walkPredicate(node.filter, visit);
      }
    })
    .with({ kind: "literal" }, { kind: "output-ref" }, () => {
      // Leaf.
    })
    .with({ kind: "arithmetic" }, (node) => {
      walkAggregateExpr(node.left, visit);
      walkAggregateExpr(node.right, visit);
    })
    .with({ kind: "scalar-call" }, (node) => {
      for (const arg of node.args) {
        walkAggregateExpr(arg, visit);
      }
    })
    .exhaustive();
}

/** Visit every HAVING node plus every aggregate/scalar node under it. */
export function walkHavingPredicate(
  having: ScoutQlHavingPredicate,
  visit: (node: AggregateWalkNode | ScoutQlHavingPredicate) => void,
): void {
  visit(having);
  match(having)
    .with({ kind: "and" }, { kind: "or" }, (node) => {
      for (const operand of node.operands) {
        walkHavingPredicate(operand, visit);
      }
    })
    .with({ kind: "not" }, (node) => {
      walkHavingPredicate(node.operand, visit);
    })
    .with({ kind: "compare" }, (node) => {
      walkAggregateExpr(node.left, visit);
      walkAggregateExpr(node.right, visit);
    })
    .exhaustive();
}

export function countAggregateNodes(expr: ScoutQlAggregateExpr): number {
  let count = 0;
  walkAggregateExpr(expr, () => {
    count += 1;
  });
  return count;
}

export function countHavingNodes(having: ScoutQlHavingPredicate): number {
  let count = 0;
  walkHavingPredicate(having, () => {
    count += 1;
  });
  return count;
}

export function collectAggregateColumnNames(
  expr: ScoutQlAggregateExpr,
  into: Set<string>,
): void {
  walkAggregateExpr(expr, (node) => {
    if (node.kind === "column" || node.kind === "player-ref") {
      recordColumnNames(node, into);
    }
  });
}

export function collectHavingColumnNames(
  having: ScoutQlHavingPredicate,
  into: Set<string>,
): void {
  walkHavingPredicate(having, (node) => {
    if (node.kind === "column" || node.kind === "player-ref") {
      recordColumnNames(node, into);
    }
  });
}
