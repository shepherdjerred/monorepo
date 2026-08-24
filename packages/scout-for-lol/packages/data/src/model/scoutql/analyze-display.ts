import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type { ReportDisplayKind } from "#src/model/report.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlEvidence,
  ScoutQlPredicate,
} from "#src/model/scoutql/expression.ts";
import type { SourceCatalog } from "#src/model/scoutql/catalog-columns.ts";
import { type ExprTypingContext } from "#src/model/scoutql/analyze-expr-shared.ts";
import { typeOfExpr } from "#src/model/scoutql/analyze-expr.ts";
import {
  lowerPredicate,
  lowerScalar,
  type PlayerRefCollector,
} from "#src/model/scoutql/analyze-lower.ts";
import { lowerAggregate } from "#src/model/scoutql/analyze-lower-aggregate.ts";

// ── Display kind, additivity, and evidence ───────────────────────────────────
// Three inferences the renderer and the statistics layer depend on, all read
// off the output's expression SHAPE:
//
// - displayKind decides formatting (57% vs 0.57 vs 34:12).
// - additive decides whether `cumulative` is meaningful — a running total of
//   averages is nonsense, of counts it is not.
// - evidence decides which confidence interval the renderer may draw. Wilson
//   intervals need successes/trials, and under a FILTER a blanket COUNT(*)
//   would be the wrong denominator — which is precisely when the interval
//   matters most.

type CallNode = Extract<ScoutQlExprAst, { kind: "call" }>;

/** Type an expression without emitting diagnostics (already reported once). */
function silentType(expr: ScoutQlExprAst, ctx: ExprTypingContext): string {
  return typeOfExpr(expr, { ...ctx, diagnostics: [] });
}

/** Unwrap a ROUND(x[, digits]) wrapper so `ROUND(AVG(win::INT), 2)` still reads as a rate. */
function unwrapRound(expr: ScoutQlExprAst): ScoutQlExprAst {
  if (expr.kind === "call" && expr.name === "round" && expr.args.length > 0) {
    const [inner] = expr.args;
    if (inner !== undefined) {
      return unwrapRound(inner);
    }
  }
  return expr;
}

/**
 * `AVG(<boolean>::INT)` — the win-rate shape. Returns the cast argument so
 * evidence can rebuild `SUM(<same cast>)` with the same FILTER.
 */
function rateShape(
  expr: ScoutQlExprAst,
  ctx: ExprTypingContext,
): { cast: ScoutQlExprAst; call: CallNode } | undefined {
  const call = unwrapRound(expr);
  if (call.kind !== "call" || call.name !== "avg" || call.args.length !== 1) {
    return undefined;
  }
  const [arg] = call.args;
  if (arg?.kind !== "cast") {
    return undefined;
  }
  const to = arg.to === "integer" ? "int" : arg.to;
  if (to !== "int" && to !== "bigint" && to !== "double") {
    return undefined;
  }
  if (silentType(arg.operand, { ...ctx, inAggregate: true }) !== "boolean") {
    return undefined;
  }
  return { cast: arg, call };
}

function columnDisplayKind(
  arg: ScoutQlExprAst,
  catalog: SourceCatalog | undefined,
): ReportDisplayKind | undefined {
  if (arg.kind !== "column") {
    return undefined;
  }
  return catalog?.columns.get(arg.name)?.displayKind;
}

const DURATION_AGGREGATES: ReadonlySet<string> = new Set([
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "quantile_cont",
]);

export function inferDisplayKind(
  expr: ScoutQlExprAst,
  ctx: ExprTypingContext,
): ReportDisplayKind {
  if (rateShape(expr, ctx) !== undefined) {
    return "percent";
  }
  const call = unwrapRound(expr);
  if (call.kind !== "call") {
    return "decimal";
  }
  if (call.name === "kda" || call.name === "per_minute") {
    return "ratio";
  }
  if (call.name === "count") {
    return "count";
  }
  const [arg] = call.args;
  if (arg === undefined) {
    return "decimal";
  }
  if (
    DURATION_AGGREGATES.has(call.name) &&
    columnDisplayKind(arg, ctx.catalog) === "duration"
  ) {
    return "duration";
  }
  // SUM/MIN/MAX of an integer are still whole numbers, so they format as
  // counts. AVG/MEDIAN/QUANTILE/STDDEV interpolate and stay decimal.
  if (
    WHOLE_NUMBER_PRESERVING.has(call.name) &&
    silentType(arg, { ...ctx, inAggregate: true }) === "integer"
  ) {
    return "count";
  }
  return "decimal";
}

const WHOLE_NUMBER_PRESERVING: ReadonlySet<string> = new Set([
  "sum",
  "min",
  "max",
]);

// ── Additivity ───────────────────────────────────────────────────────────────

function isNumericLiteral(expr: ScoutQlExprAst): boolean {
  if (expr.kind === "number") {
    return true;
  }
  return (
    expr.kind === "unary" && expr.op === "-" && expr.operand.kind === "number"
  );
}

/**
 * SUM/COUNT composed with +/-, or scaled by a numeric literal, stays a total
 * you can accumulate. Anything else (AVG, MEDIAN, a ratio, a rounding) does
 * not: summing averages across buckets does not produce the overall average.
 */
export function isAdditive(expr: ScoutQlExprAst): boolean {
  if (expr.kind === "call") {
    // NULLIF(total, 0) is the divide-by-zero guard, not a transform: it maps a
    // sentinel to NULL and leaves the total otherwise intact. Recognizing it
    // is what lets `SUM(a) / NULLIF(SUM(b), 0)` earn ratio evidence. The
    // quotient itself is still non-additive, so `cumulative` still refuses it.
    if (expr.name === "nullif" && expr.args.length === 2) {
      const [value, sentinel] = expr.args;
      return (
        value !== undefined &&
        sentinel !== undefined &&
        isNumericLiteral(sentinel) &&
        isAdditive(value)
      );
    }
    return expr.name === "sum" || (expr.name === "count" && !expr.distinct);
  }
  if (expr.kind === "binary") {
    const { op, left, right } = expr;
    if (op === "+" || op === "-") {
      return isAdditive(left) && isAdditive(right);
    }
    if (op === "*") {
      return (
        (isAdditive(left) && isNumericLiteral(right)) ||
        (isNumericLiteral(left) && isAdditive(right))
      );
    }
    if (op === "/") {
      return isAdditive(left) && isNumericLiteral(right);
    }
  }
  return false;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export type EvidenceContext = {
  typing: ExprTypingContext;
  refs: PlayerRefCollector;
};

const NO_OUTPUT_REFS: ReadonlySet<string> = new Set();

function lowerFilter(
  call: CallNode,
  refs: PlayerRefCollector,
): ScoutQlPredicate | undefined {
  return call.filter === undefined
    ? undefined
    : lowerPredicate(call.filter, refs);
}

function rateEvidence(
  shape: { cast: ScoutQlExprAst; call: CallNode },
  ctx: EvidenceContext,
): ScoutQlEvidence | undefined {
  const arg = lowerScalar(shape.cast);
  if (arg === undefined) {
    return undefined;
  }
  const filter = lowerFilter(shape.call, ctx.refs);
  const filterPart = filter === undefined ? {} : { filter };
  return {
    kind: "rate",
    successes: {
      kind: "aggregate",
      func: "sum",
      arg,
      distinct: false,
      ...filterPart,
    },
    trials: { kind: "count-star", ...filterPart },
  };
}

function averageEvidence(
  call: CallNode,
  ctx: EvidenceContext,
): ScoutQlEvidence | undefined {
  const [argAst] = call.args;
  if (argAst === undefined) {
    return undefined;
  }
  const arg = lowerScalar(argAst);
  if (arg === undefined) {
    return undefined;
  }
  const filter = lowerFilter(call, ctx.refs);
  const filterPart = filter === undefined ? {} : { filter };
  return {
    kind: "ratio",
    numerator: {
      kind: "aggregate",
      func: "sum",
      arg,
      distinct: false,
      ...filterPart,
    },
    denominator: {
      kind: "aggregate",
      func: "count",
      arg,
      distinct: false,
      ...filterPart,
    },
  };
}

function quotientEvidence(
  expr: ScoutQlExprAst,
  ctx: EvidenceContext,
): ScoutQlEvidence | undefined {
  if (expr.kind !== "binary" || expr.op !== "/") {
    return undefined;
  }
  if (!isAdditive(expr.left) || !isAdditive(expr.right)) {
    return undefined;
  }
  const lowerCtx = { refs: ctx.refs, outputNames: NO_OUTPUT_REFS };
  const numerator = lowerAggregate(expr.left, lowerCtx);
  const denominator = lowerAggregate(expr.right, lowerCtx);
  if (numerator === undefined || denominator === undefined) {
    return undefined;
  }
  return { kind: "ratio", numerator, denominator };
}

/**
 * Evidence companions for an output. A SELECT output can never contain an
 * `output-ref` (alias references are legal only in HAVING/ORDER BY), so the
 * companions this derives are output-ref-free by construction — which is what
 * the engine requires of them.
 */
export function inferEvidence(
  expr: ScoutQlExprAst,
  ctx: EvidenceContext,
): ScoutQlEvidence {
  const shape = rateShape(expr, ctx.typing);
  if (shape !== undefined) {
    return rateEvidence(shape, ctx) ?? { kind: "sample" };
  }
  const call = unwrapRound(expr);
  if (call.kind === "call" && call.name === "avg" && call.args.length === 1) {
    return averageEvidence(call, ctx) ?? { kind: "sample" };
  }
  return quotientEvidence(call, ctx) ?? { kind: "sample" };
}

/** Whether an aggregate expression mentions another output by alias. */
export function containsOutputRef(expr: ScoutQlAggregateExpr): boolean {
  switch (expr.kind) {
    case "output-ref":
      return true;
    case "arithmetic":
      return containsOutputRef(expr.left) || containsOutputRef(expr.right);
    case "scalar-call":
      return expr.args.some((arg) => containsOutputRef(arg));
    case "count-star":
    case "aggregate":
    case "quantile":
    case "literal":
      return false;
  }
}
