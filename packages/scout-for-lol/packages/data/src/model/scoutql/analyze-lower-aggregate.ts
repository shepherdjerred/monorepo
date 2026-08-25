import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlHavingPredicate,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "#src/model/scoutql/expression.ts";
import {
  allDefined,
  arithmeticOp,
  compareOp,
  lowerPredicate,
  lowerScalar,
  scalarFunction,
  type PlayerRefCollector,
} from "#src/model/scoutql/analyze-lower.ts";

// ── Aggregate lowering (with macro expansion) ────────────────────────────────
// The two aggregate macros expand HERE, so the engine only ever sees core
// vocabulary:
//   kda()         → (SUM(kills) + SUM(assists)) / GREATEST(SUM(deaths), 1)
//   per_minute(x) → SUM(x) / NULLIF(SUM(time_played) / 60, 0)
// Neither carries a `::DOUBLE`: DuckDB's `/` is already floating point, and
// the aggregate IR deliberately has no cast node (see `cast-around-aggregate`).

function sumOf(column: string): ScoutQlAggregateExpr {
  return {
    kind: "aggregate",
    func: "sum",
    arg: { kind: "column", column },
    distinct: false,
  };
}

function withFilter(
  expr: ScoutQlAggregateExpr,
  filter: ScoutQlPredicate | undefined,
): ScoutQlAggregateExpr {
  if (filter === undefined) {
    return expr;
  }
  return match(expr)
    .with(
      { kind: "count-star" },
      { kind: "aggregate" },
      { kind: "quantile" },
      (node): ScoutQlAggregateExpr => ({ ...node, filter }),
    )
    .with({ kind: "arithmetic" }, (node): ScoutQlAggregateExpr => ({
      ...node,
      left: withFilter(node.left, filter),
      right: withFilter(node.right, filter),
    }))
    .with({ kind: "scalar-call" }, (node): ScoutQlAggregateExpr => ({
      ...node,
      args: node.args.map((arg) => withFilter(arg, filter)),
    }))
    .with(
      { kind: "literal" },
      { kind: "output-ref" },
      (node): ScoutQlAggregateExpr => node,
    )
    .exhaustive();
}

/** `(SUM(kills) + SUM(assists)) / GREATEST(SUM(deaths), 1)`. */
function kdaMacro(): ScoutQlAggregateExpr {
  return {
    kind: "arithmetic",
    op: "/",
    left: {
      kind: "arithmetic",
      op: "+",
      left: sumOf("kills"),
      right: sumOf("assists"),
    },
    right: {
      kind: "scalar-call",
      func: "greatest",
      args: [sumOf("deaths"), { kind: "literal", value: 1 }],
    },
  };
}

/** `SUM(x) / NULLIF(SUM(time_played) / 60, 0)`. */
function perMinuteMacro(arg: ScoutQlScalarExpr): ScoutQlAggregateExpr {
  return {
    kind: "arithmetic",
    op: "/",
    left: { kind: "aggregate", func: "sum", arg, distinct: false },
    right: {
      kind: "scalar-call",
      func: "nullif",
      args: [
        {
          kind: "arithmetic",
          op: "/",
          left: sumOf("time_played"),
          right: { kind: "literal", value: 60 },
        },
        { kind: "literal", value: 0 },
      ],
    },
  };
}

export type AggregateLowerContext = {
  refs: PlayerRefCollector;
  /** Alias references are legal in HAVING / ORDER BY only. */
  outputNames: ReadonlySet<string>;
};

function lowerAggregateCall(
  node: Extract<ScoutQlExprAst, { kind: "call" }>,
  ctx: AggregateLowerContext,
): ScoutQlAggregateExpr | undefined {
  const filter =
    node.filter === undefined
      ? undefined
      : lowerPredicate(node.filter, ctx.refs);
  if (filter === undefined && node.filter !== undefined) {
    return undefined;
  }
  if (node.name === "kda") {
    return withFilter(kdaMacro(), filter);
  }
  if (node.name === "per_minute") {
    const arg =
      node.args[0] === undefined ? undefined : lowerScalar(node.args[0]);
    return arg === undefined
      ? undefined
      : withFilter(perMinuteMacro(arg), filter);
  }
  if (node.name === "count" && node.star) {
    return { kind: "count-star", ...(filter === undefined ? {} : { filter }) };
  }
  const argAst = node.args[0];
  if (argAst === undefined) {
    return undefined;
  }
  const arg = lowerScalar(argAst);
  if (arg === undefined) {
    return undefined;
  }
  if (node.name === "quantile_cont") {
    const fraction = node.args[1];
    if (fraction?.kind !== "number") {
      return undefined;
    }
    return {
      kind: "quantile",
      arg,
      q: fraction.value,
      ...(filter === undefined ? {} : { filter }),
    };
  }
  return match(node.name)
    .with(
      "count",
      "sum",
      "avg",
      "min",
      "max",
      "median",
      "stddev",
      (func): ScoutQlAggregateExpr => ({
        kind: "aggregate",
        func,
        arg,
        distinct: node.distinct,
        ...(filter === undefined ? {} : { filter }),
      }),
    )
    .otherwise((): undefined => undefined);
}

export function lowerAggregate(
  expr: ScoutQlExprAst,
  ctx: AggregateLowerContext,
): ScoutQlAggregateExpr | undefined {
  return match(expr)
    .with({ kind: "call" }, (node): ScoutQlAggregateExpr | undefined => {
      const scalar = scalarFunction(node.name);
      if (scalar !== undefined) {
        const args = allDefined(
          node.args.map((arg) => lowerAggregate(arg, ctx)),
        );
        return args === undefined || args.length === 0
          ? undefined
          : { kind: "scalar-call", func: scalar, args };
      }
      return lowerAggregateCall(node, ctx);
    })
    .with({ kind: "number" }, (node): ScoutQlAggregateExpr => ({
      kind: "literal",
      value: node.value,
    }))
    .with(
      { kind: "unary", op: "-" },
      (node): ScoutQlAggregateExpr | undefined =>
        node.operand.kind === "number"
          ? { kind: "literal", value: -node.operand.value }
          : undefined,
    )
    .with({ kind: "binary" }, (node): ScoutQlAggregateExpr | undefined => {
      const op = arithmeticOp(node.op);
      if (op === undefined) {
        return undefined;
      }
      const left = lowerAggregate(node.left, ctx);
      const right = lowerAggregate(node.right, ctx);
      return left === undefined || right === undefined
        ? undefined
        : { kind: "arithmetic", op, left, right };
    })
    .with({ kind: "column" }, (node): ScoutQlAggregateExpr | undefined =>
      ctx.outputNames.has(node.name)
        ? { kind: "output-ref", name: node.name }
        : undefined,
    )
    .otherwise((): undefined => undefined);
}

export function lowerHaving(
  expr: ScoutQlExprAst,
  ctx: AggregateLowerContext,
): ScoutQlHavingPredicate | undefined {
  return match(expr)
    .with(
      { kind: "binary", op: "and" },
      { kind: "binary", op: "or" },
      (node): ScoutQlHavingPredicate | undefined => {
        const kind = node.op === "and" ? "and" : "or";
        const left = lowerHaving(node.left, ctx);
        const right = lowerHaving(node.right, ctx);
        if (left === undefined || right === undefined) {
          return undefined;
        }
        const operands = [
          ...(left.kind === kind ? left.operands : [left]),
          ...(right.kind === kind ? right.operands : [right]),
        ];
        return { kind, operands };
      },
    )
    .with(
      { kind: "unary", op: "not" },
      (node): ScoutQlHavingPredicate | undefined => {
        const operand = lowerHaving(node.operand, ctx);
        return operand === undefined ? undefined : { kind: "not", operand };
      },
    )
    .with({ kind: "binary" }, (node): ScoutQlHavingPredicate | undefined => {
      const op = compareOp(node.op);
      if (op === undefined) {
        return undefined;
      }
      const left = lowerAggregate(node.left, ctx);
      const right = lowerAggregate(node.right, ctx);
      return left === undefined || right === undefined
        ? undefined
        : { kind: "compare", op, left, right };
    })
    .otherwise((): undefined => undefined);
}
