import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import {
  emitDiagnostic,
  playerRefShape,
  type ExprTyper,
  type ExprTypingContext,
  type ScoutQlExprClause,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import {
  typeArithmetic,
  typeAtTimeZone,
  typeBetween,
  typeCast,
  typeColumn,
  typeComparisonSides,
  typeIn,
  typeInterval,
} from "#src/model/scoutql/analyze-expr-atoms.ts";
import { typeCall } from "#src/model/scoutql/analyze-expr-call.ts";

// ── ScoutQL expression analysis: the two typing entry points ─────────────────
// `typeOfExpr` types a VALUE; `typeConditionExpr` checks a CONDITION. Both are
// total: they never throw, they emit coded diagnostics, and they answer
// "unknown" for anything already diagnosed so one mistake yields one message.
// Where ScoutQL overlaps SQL the rules are DuckDB's — float `/`, `AVG(win)` is
// a type error without `::INT`, timestamp ± interval, implicit varchar↔temporal
// comparison casts.

const ARITHMETIC_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);

/** Type a VALUE expression (SELECT items, aggregate arguments, operands). */
export function typeOfExpr(
  expr: ScoutQlExprAst,
  ctx: ExprTypingContext,
): ScoutQlExprType {
  return match(expr)
    .with({ kind: "error" }, (): ScoutQlExprType => "unknown")
    .with({ kind: "column" }, (node) => typeColumn(node, ctx))
    .with({ kind: "number" }, (node): ScoutQlExprType =>
      Number.isInteger(node.value) ? "integer" : "double",
    )
    .with({ kind: "string" }, (): ScoutQlExprType => "varchar")
    .with({ kind: "boolean" }, (): ScoutQlExprType => "boolean")
    .with({ kind: "null" }, (node): ScoutQlExprType => {
      emitDiagnostic(ctx.diagnostics, {
        code: "type-mismatch",
        message: "NULL literals are only supported via IS NULL / IS NOT NULL.",
        span: node.span,
      });
      return "unknown";
    })
    .with({ kind: "interval" }, (node) => typeInterval(node, ctx))
    .with({ kind: "now" }, (node): ScoutQlExprType =>
      node.which === "timestamp" ? "timestamp" : "date",
    )
    .with({ kind: "unary" }, (node): ScoutQlExprType => {
      if (node.op === "not") {
        typeConditionExpr(node.operand, ctx);
        return "boolean";
      }
      const operandType = typeOfExpr(node.operand, ctx);
      if (operandType !== "unknown" && !isNumericType(operandType)) {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message: `Unary minus needs a number; got ${operandType}.`,
          span: node.span,
        });
        return "unknown";
      }
      return operandType;
    })
    .with({ kind: "binary" }, (node): ScoutQlExprType => {
      if (node.op === "and" || node.op === "or") {
        typeConditionExpr(node, ctx);
        return "boolean";
      }
      if (node.op === "at-time-zone") {
        return typeAtTimeZone(node, ctx, TYPER);
      }
      if (ARITHMETIC_OPS.has(node.op)) {
        const left = typeOfExpr(node.left, ctx);
        const right = typeOfExpr(node.right, ctx);
        return typeArithmetic(node, { left, right }, ctx);
      }
      // A comparison used as a value: type it as the condition it is.
      typeConditionExpr(node, ctx);
      return "boolean";
    })
    .with({ kind: "cast" }, (node) => typeCast(node, ctx, TYPER))
    .with({ kind: "in" }, (node) => typeIn(node, ctx, TYPER))
    .with({ kind: "between" }, (node) => typeBetween(node, ctx, TYPER))
    .with({ kind: "is-null" }, (node): ScoutQlExprType => {
      typeOfExpr(node.operand, ctx);
      return "boolean";
    })
    .with({ kind: "call" }, (node) => typeCall(node, ctx, TYPER))
    .exhaustive();
}

function isNumericType(type: ScoutQlExprType): boolean {
  return type === "integer" || type === "double";
}

function conditionMisuseMessage(clause: ScoutQlExprClause): string {
  return clause === "having"
    ? "HAVING supports AND/OR/NOT over comparisons of aggregates and output aliases."
    : "Expected a condition (a comparison, IN, BETWEEN, IS NULL, or a boolean column).";
}

/** HAVING compares aggregates; set-membership forms have no aggregate form. */
function rejectInHaving(
  node: { span: { start: number; end: number } },
  ctx: ExprTypingContext,
): boolean {
  if (ctx.clause !== "having") {
    return false;
  }
  emitDiagnostic(ctx.diagnostics, {
    code: "type-mismatch",
    message: conditionMisuseMessage("having"),
    span: node.span,
  });
  return true;
}

function typePlayerRefCondition(
  expr: ScoutQlExprAst,
  ctx: ExprTypingContext,
): boolean {
  const shape = playerRefShape(expr);
  if (shape === undefined) {
    return false;
  }
  if (ctx.clause === "where" && ctx.allowPlayerRef) {
    return true;
  }
  emitDiagnostic(ctx.diagnostics, {
    code: "player-ref-unavailable",
    message:
      ctx.clause === "where"
        ? `player('…') is not available on ${ctx.catalog?.id ?? "this source"}.`
        : "player('…') is only valid in the WHERE clause.",
    span: shape.span,
  });
  return true;
}

/** Type a CONDITION (WHERE conjunct, FILTER body, HAVING expression). */
export function typeConditionExpr(
  expr: ScoutQlExprAst,
  ctx: ExprTypingContext,
): void {
  if (typePlayerRefCondition(expr, ctx)) {
    return;
  }
  match(expr)
    .with(
      { kind: "binary", op: "and" },
      { kind: "binary", op: "or" },
      (node) => {
        typeConditionExpr(node.left, ctx);
        typeConditionExpr(node.right, ctx);
      },
    )
    .with({ kind: "unary", op: "not" }, (node) => {
      typeConditionExpr(node.operand, ctx);
    })
    .with(
      { kind: "binary", op: "=" },
      { kind: "binary", op: "!=" },
      { kind: "binary", op: "<" },
      { kind: "binary", op: "<=" },
      { kind: "binary", op: ">" },
      { kind: "binary", op: ">=" },
      { kind: "binary", op: "like" },
      { kind: "binary", op: "ilike" },
      (node) => {
        typeComparisonSides(node, ctx, TYPER);
      },
    )
    .with({ kind: "in" }, (node) => {
      if (!rejectInHaving(node, ctx)) {
        typeIn(node, ctx, TYPER);
      }
    })
    .with({ kind: "between" }, (node) => {
      if (!rejectInHaving(node, ctx)) {
        typeBetween(node, ctx, TYPER);
      }
    })
    .with({ kind: "is-null" }, (node) => {
      if (!rejectInHaving(node, ctx)) {
        typeOfExpr(node.operand, ctx);
      }
    })
    .with({ kind: "boolean" }, () => {
      // A bare TRUE/FALSE is a legal (if pointless) condition.
    })
    .with({ kind: "error" }, () => {
      // Already diagnosed by the parser.
    })
    .otherwise((node) => {
      const type = typeOfExpr(node, ctx);
      if (type !== "boolean" && type !== "unknown") {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message: conditionMisuseMessage(ctx.clause),
          span: node.span,
        });
      }
    });
}

/** The recursion port handed to the atom and call modules. */
const TYPER: ExprTyper = { typeOfExpr, typeConditionExpr };
