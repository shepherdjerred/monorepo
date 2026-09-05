import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlArithmeticOp,
  ScoutQlCompareOp,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
  ScoutQlScalarFunction,
} from "#src/model/scoutql/expression.ts";
import {
  ScoutQlArithmeticOpSchema,
  ScoutQlCompareOpSchema,
  ScoutQlScalarFunctionSchema,
} from "#src/model/scoutql/expression.ts";
import { resolveReportChampion } from "#src/model/reports/report-query-champions.ts";
import {
  inItemLiteral,
  normalizeCastType,
  normalizeIntervalUnit,
  playerRefShape,
} from "#src/model/scoutql/analyze-expr-shared.ts";

// ── AST → plan IR lowering: scalars and predicates ───────────────────────────
// Runs after analysis has typed the tree, so every shape reaching here is one
// the analyzer accepted. `undefined` means "not representable" and always
// corresponds to an error diagnostic already emitted — compile.ts treats a
// surviving `undefined` as an internal invariant violation, and the
// compile-succeeds-iff-no-errors property test is what keeps the two in step.
//
// `champion('N')` constant-folds to its numeric id here; the two aggregate
// macros expand in analyze-lower-aggregate.ts.

/** Collects `player('…')` names, de-duplicated, in first-seen order. */
export class PlayerRefCollector {
  private readonly indexes = new Map<string, number>();
  readonly names: string[] = [];

  indexOf(name: string): number {
    const key = name.trim().toLocaleLowerCase("en-US");
    const existing = this.indexes.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.names.length;
    this.indexes.set(key, index);
    this.names.push(name.trim());
    return index;
  }
}

export function arithmeticOp(op: string): ScoutQlArithmeticOp | undefined {
  const parsed = ScoutQlArithmeticOpSchema.safeParse(op);
  return parsed.success ? parsed.data : undefined;
}

export function compareOp(op: string): ScoutQlCompareOp | undefined {
  const parsed = ScoutQlCompareOpSchema.safeParse(op);
  return parsed.success ? parsed.data : undefined;
}

export function scalarFunction(
  name: string,
): ScoutQlScalarFunction | undefined {
  const parsed = ScoutQlScalarFunctionSchema.safeParse(name);
  return parsed.success ? parsed.data : undefined;
}

export function allDefined<T>(values: (T | undefined)[]): T[] | undefined {
  const out: T[] = [];
  for (const value of values) {
    if (value === undefined) {
      return undefined;
    }
    out.push(value);
  }
  return out;
}

// ── Scalar (raw-row) lowering ────────────────────────────────────────────────

function lowerScalarCall(
  node: Extract<ScoutQlExprAst, { kind: "call" }>,
): ScoutQlScalarExpr | undefined {
  if (node.name === "champion") {
    const [arg] = node.args;
    if (arg?.kind !== "string") {
      return undefined;
    }
    const champion = resolveReportChampion(arg.value);
    return champion === undefined
      ? undefined
      : { kind: "literal", value: champion.id };
  }
  const func = scalarFunction(node.name);
  if (func === undefined) {
    return undefined;
  }
  const args = allDefined(node.args.map((arg) => lowerScalar(arg)));
  if (args === undefined || args.length === 0) {
    return undefined;
  }
  return { kind: "scalar-call", func, args };
}

export function lowerScalar(
  expr: ScoutQlExprAst,
): ScoutQlScalarExpr | undefined {
  return match(expr)
    .with({ kind: "column" }, (node): ScoutQlScalarExpr => ({
      kind: "column",
      column: node.name,
    }))
    .with(
      { kind: "number" },
      { kind: "string" },
      { kind: "boolean" },
      (node): ScoutQlScalarExpr => ({ kind: "literal", value: node.value }),
    )
    .with({ kind: "interval" }, (node): ScoutQlScalarExpr | undefined => {
      const unit = normalizeIntervalUnit(node.unit);
      if (unit === undefined || node.amount === null) {
        return undefined;
      }
      return { kind: "interval", amount: node.amount, unit };
    })
    .with({ kind: "now" }, (node): ScoutQlScalarExpr => ({
      kind: "now",
      which: node.which,
    }))
    .with({ kind: "unary" }, (node): ScoutQlScalarExpr | undefined => {
      if (node.op !== "-") {
        return lowerScalarPredicate(node);
      }
      const operand = lowerScalar(node.operand);
      return operand === undefined ? undefined : { kind: "negate", operand };
    })
    .with({ kind: "binary" }, (node): ScoutQlScalarExpr | undefined => {
      if (node.op === "at-time-zone") {
        const operand = lowerScalar(node.left);
        if (operand === undefined || node.right.kind !== "string") {
          return undefined;
        }
        return { kind: "at-time-zone", operand, timezone: node.right.value };
      }
      const op = arithmeticOp(node.op);
      if (op === undefined) {
        // Comparison, LIKE/ILIKE, AND/OR: boolean-valued, so it lowers as a
        // predicate used as a value rather than as arithmetic.
        return lowerScalarPredicate(node);
      }
      const left = lowerScalar(node.left);
      const right = lowerScalar(node.right);
      return left === undefined || right === undefined
        ? undefined
        : { kind: "arithmetic", op, left, right };
    })
    .with({ kind: "cast" }, (node): ScoutQlScalarExpr | undefined => {
      const to = normalizeCastType(node.to);
      const operand = lowerScalar(node.operand);
      return to === undefined || operand === undefined
        ? undefined
        : { kind: "cast", to, operand };
    })
    .with({ kind: "call" }, (node) => lowerScalarCall(node))
    .with(
      { kind: "in" },
      { kind: "between" },
      { kind: "is-null" },
      (node): ScoutQlScalarExpr | undefined => lowerScalarPredicate(node),
    )
    .with({ kind: "null" }, { kind: "error" }, (): undefined => undefined)
    .exhaustive();
}

/**
 * Lower a boolean-valued expression used as a VALUE — `(placement <= 2)::INT`,
 * `(queue IN ('solo'))::INT`. SQL has no separate condition type, so the same
 * predicate lowering serves both positions.
 *
 * `player('…')` is refused here: it resolves to a PUUID set at execution, so
 * as a per-row boolean it would silently mean something else. The collector is
 * local and discarded, so a name lifted while lowering cannot leak into the
 * plan's playerRefs.
 */
function lowerScalarPredicate(
  expr: ScoutQlExprAst,
): ScoutQlScalarExpr | undefined {
  const refs = new PlayerRefCollector();
  const predicate = lowerPredicate(expr, refs);
  if (predicate === undefined || refs.names.length > 0) {
    return undefined;
  }
  return { kind: "predicate", predicate };
}

// ── Predicate lowering ───────────────────────────────────────────────────────

/** `WHERE win` is `win = TRUE`; `WHERE TRUE` is `TRUE = TRUE`. */
function truthy(operand: ScoutQlScalarExpr): ScoutQlPredicate {
  return {
    kind: "compare",
    op: "=",
    left: operand,
    right: { kind: "literal", value: true },
  };
}

function lowerAndOr(
  node: Extract<ScoutQlExprAst, { kind: "binary" }>,
  refs: PlayerRefCollector,
): ScoutQlPredicate | undefined {
  const kind = node.op === "and" ? "and" : "or";
  const flat: ScoutQlExprAst[] = [];
  const collect = (candidate: ScoutQlExprAst): void => {
    if (candidate.kind === "binary" && candidate.op === node.op) {
      collect(candidate.left);
      collect(candidate.right);
      return;
    }
    flat.push(candidate);
  };
  collect(node);
  const operands = allDefined(
    flat.map((operand) => lowerPredicate(operand, refs)),
  );
  if (operands === undefined || operands.length < 2) {
    return undefined;
  }
  return { kind, operands };
}

export function lowerPredicate(
  expr: ScoutQlExprAst,
  refs: PlayerRefCollector,
): ScoutQlPredicate | undefined {
  const playerRef = playerRefShape(expr);
  if (playerRef !== undefined) {
    return { kind: "player-ref", index: refs.indexOf(playerRef.name) };
  }
  return match(expr)
    .with({ kind: "binary", op: "and" }, { kind: "binary", op: "or" }, (node) =>
      lowerAndOr(node, refs),
    )
    .with(
      { kind: "unary", op: "not" },
      (node): ScoutQlPredicate | undefined => {
        const operand = lowerPredicate(node.operand, refs);
        return operand === undefined ? undefined : { kind: "not", operand };
      },
    )
    .with({ kind: "binary" }, (node): ScoutQlPredicate | undefined => {
      const op = compareOp(node.op);
      if (op === undefined) {
        return undefined;
      }
      const left = lowerScalar(node.left);
      const right = lowerScalar(node.right);
      return left === undefined || right === undefined
        ? undefined
        : { kind: "compare", op, left, right };
    })
    .with({ kind: "in" }, (node): ScoutQlPredicate | undefined => {
      const operand = lowerScalar(node.operand);
      const items = allDefined(
        node.items.map((item) => inItemLiteral(item)?.value),
      );
      if (operand === undefined || items === undefined || items.length === 0) {
        return undefined;
      }
      return { kind: "in", operand, negated: node.negated, items };
    })
    .with({ kind: "between" }, (node): ScoutQlPredicate | undefined => {
      const operand = lowerScalar(node.operand);
      const low = lowerScalar(node.low);
      const high = lowerScalar(node.high);
      return operand === undefined || low === undefined || high === undefined
        ? undefined
        : { kind: "between", operand, negated: node.negated, low, high };
    })
    .with({ kind: "is-null" }, (node): ScoutQlPredicate | undefined => {
      const operand = lowerScalar(node.operand);
      return operand === undefined
        ? undefined
        : { kind: "is-null", operand, negated: node.negated };
    })
    .otherwise((node): ScoutQlPredicate | undefined => {
      const operand = lowerScalar(node);
      return operand === undefined ? undefined : truthy(operand);
    });
}
