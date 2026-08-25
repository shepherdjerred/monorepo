import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlColumnInfo } from "#src/model/scoutql/catalog-columns.ts";
import { closestScoutQlName } from "#src/model/scoutql/catalog-functions.ts";
import {
  castResultType,
  columnExprType,
  comparable,
  containsErrorNode,
  emitDiagnostic,
  exprContainsAggregate,
  inItemLiteral,
  isNumeric,
  isValidTimeZone,
  normalizeCastType,
  normalizeIntervalUnit,
  type ExprTyper,
  type ExprTypingContext,
  type ScoutQlExprClause,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze-expr-shared.ts";

// ── Atoms: column resolution and the non-call operators ──────────────────────
// Name resolution against the source catalog (with did-you-mean), plus typing
// for INTERVAL, arithmetic, casts, AT TIME ZONE, comparisons, IN, and BETWEEN.
// Recursion into sub-expressions goes through the injected `ExprTyper`.

// ── Column resolution ────────────────────────────────────────────────────────

function contextAllows(
  column: ScoutQlColumnInfo,
  clause: ScoutQlExprClause,
): boolean {
  return match(clause)
    .with("where", "filter", () => column.contexts.where)
    .with("group", () => column.contexts.groupBy)
    .with("select", "having", () => column.contexts.select)
    .exhaustive();
}

function sourceContextMessage(
  column: ScoutQlColumnInfo,
  ctx: ExprTypingContext,
): string {
  const source = ctx.catalog?.id ?? "this source";
  return match(ctx.clause)
    .with(
      "where",
      "filter",
      () =>
        `"${column.name}" cannot be filtered on ${source} — it is per-member data with no single value for a group.`,
    )
    .with(
      "group",
      () => `"${column.name}" cannot be a GROUP BY dimension on ${source}.`,
    )
    .with(
      "select",
      "having",
      () => `"${column.name}" cannot be aggregated on ${source}.`,
    )
    .exhaustive();
}

function typeColumnInHaving(
  node: { name: string; span: ScoutQlSpan },
  ctx: ExprTypingContext,
): ScoutQlExprType {
  const aliasType = ctx.outputAliases.get(node.name);
  if (aliasType !== undefined) {
    return aliasType;
  }
  const catalogColumn = ctx.catalog?.columns.get(node.name);
  const suggestion =
    catalogColumn === undefined
      ? closestScoutQlName(node.name, [
          ...ctx.outputAliases.keys(),
          ...(ctx.catalog?.columns.keys() ?? []),
        ])
      : undefined;
  emitDiagnostic(ctx.diagnostics, {
    code: "having-target-unknown",
    message:
      catalogColumn === undefined
        ? `"${node.name}" is not an output alias or aggregate.${suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`}`
        : `HAVING sees aggregated rows — aggregate "${node.name}" (e.g. SUM(${node.name})) or filter it in WHERE.`,
    span: node.span,
  });
  return "unknown";
}

export function typeColumn(
  node: { name: string; span: ScoutQlSpan },
  ctx: ExprTypingContext,
): ScoutQlExprType {
  if (ctx.catalog === undefined) {
    return "unknown";
  }
  if (ctx.clause === "having") {
    return typeColumnInHaving(node, ctx);
  }
  const column = ctx.catalog.columns.get(node.name);
  if (column !== undefined) {
    if (!contextAllows(column, ctx.clause)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "source-column-context",
        message: sourceContextMessage(column, ctx),
        span: node.span,
      });
    }
    return columnExprType(column);
  }
  if (ctx.clause === "where" && ctx.outputAliases.has(node.name)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "aggregate-in-where",
      message: `"${node.name}" is an output alias; WHERE filters raw rows before aggregation. Did you mean HAVING ${node.name} …?`,
      span: node.span,
    });
    return "unknown";
  }
  if (node.name === "competition_id") {
    // Reported once, by the WHERE pass, as competition-id-unavailable.
    return "integer";
  }
  if (ctx.catalog.timeColumn === null && TIME_COLUMN_NAMES.has(node.name)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "time-column-unavailable",
      message: `${ctx.catalog.id} is a snapshot of where things stand now, so it has no time column — it cannot be filtered or bucketed by time.`,
      span: node.span,
    });
    return "unknown";
  }
  const suggestion = closestScoutQlName(node.name, ctx.catalog.columns.keys());
  emitDiagnostic(ctx.diagnostics, {
    code: "unknown-column",
    message: `Unknown column "${node.name}" on ${ctx.catalog.id}.${suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`}`,
    span: node.span,
  });
  return "unknown";
}

/**
 * Time columns of the history sources. Naming one on a snapshot source is a
 * misunderstanding of the source rather than a typo, so it earns its own
 * message instead of "unknown column, did you mean …".
 */
const TIME_COLUMN_NAMES: ReadonlySet<string> = new Set([
  "game_creation_at",
  "game_start_at",
  "game_end_at",
  "observed_at",
  "calculated_at",
]);

// ── INTERVAL / arithmetic / cast / AT TIME ZONE ──────────────────────────────

export function typeInterval(
  node: Extract<ScoutQlExprAst, { kind: "interval" }>,
  ctx: ExprTypingContext,
): ScoutQlExprType {
  const unit = normalizeIntervalUnit(node.unit);
  if (
    unit === undefined ||
    node.amount === null ||
    !Number.isInteger(node.amount) ||
    node.amount <= 0
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "interval-unit-invalid",
      message:
        "INTERVAL takes a positive whole amount and a unit of second, minute, hour, day, week, month, or year.",
      span: node.span,
    });
    return "unknown";
  }
  return "interval";
}

function isTemporalType(type: ScoutQlExprType): boolean {
  return type === "timestamp" || type === "date";
}

/** Date/interval arithmetic, which DuckDB defines over a small closed table. */
function temporalArithmetic(
  op: string,
  types: { left: ScoutQlExprType; right: ScoutQlExprType },
): ScoutQlExprType | undefined {
  const { left, right } = types;
  if (op !== "+" && op !== "-") {
    return undefined;
  }
  if (right === "interval" && isTemporalType(left)) {
    return "timestamp";
  }
  if (op === "+" && left === "interval" && isTemporalType(right)) {
    return "timestamp";
  }
  if (left === "interval" && right === "interval") {
    return "interval";
  }
  if (op === "-" && isTemporalType(left) && isTemporalType(right)) {
    return left === "date" && right === "date" ? "integer" : "interval";
  }
  return undefined;
}

export function typeArithmetic(
  node: { op: string; span: ScoutQlSpan },
  types: { left: ScoutQlExprType; right: ScoutQlExprType },
  ctx: ExprTypingContext,
): ScoutQlExprType {
  const { left, right } = types;
  if (left === "unknown" || right === "unknown") {
    return "unknown";
  }
  if (isNumeric(left) && isNumeric(right)) {
    if (node.op === "/") {
      return "double";
    }
    return left === "integer" && right === "integer" ? "integer" : "double";
  }
  const temporal = temporalArithmetic(node.op, types);
  if (temporal !== undefined) {
    return temporal;
  }
  emitDiagnostic(ctx.diagnostics, {
    code: "type-mismatch",
    message: `Cannot apply ${node.op} to ${left} and ${right}.`,
    span: node.span,
  });
  return "unknown";
}

export function typeCast(
  node: Extract<ScoutQlExprAst, { kind: "cast" }>,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  typer.typeOfExpr(node.operand, ctx);
  if (
    (ctx.clause === "select" || ctx.clause === "having") &&
    ctx.inAggregate !== true &&
    exprContainsAggregate(node.operand)
  ) {
    emitDiagnostic(ctx.diagnostics, {
      code: "cast-around-aggregate",
      message:
        "Casting an aggregate result is unnecessary (DuckDB `/` is already floating-point) and unsupported — put the cast inside the argument, e.g. AVG(win::INT).",
      span: node.span,
    });
  }
  const to = normalizeCastType(node.to);
  if (to === undefined) {
    emitDiagnostic(ctx.diagnostics, {
      code: "cast-type-invalid",
      message: `Unknown cast type "${node.to}". Supported: INT, BIGINT, DOUBLE, DATE, TIMESTAMP, VARCHAR.`,
      span: node.span,
    });
    return "unknown";
  }
  return castResultType(to);
}

export function typeAtTimeZone(
  node: Extract<ScoutQlExprAst, { kind: "binary" }>,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  const operandType = typer.typeOfExpr(node.left, ctx);
  if (node.right.kind !== "string") {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: "AT TIME ZONE takes a string literal zone name.",
      span: node.right.span,
    });
    return "unknown";
  }
  if (!isValidTimeZone(node.right.value)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "time-window-invalid",
      message: `Unknown time zone "${node.right.value}".`,
      span: node.right.span,
    });
  }
  if (operandType !== "timestamp" && operandType !== "unknown") {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: `AT TIME ZONE applies to a timestamp; got ${operandType}.`,
      span: node.left.span,
    });
    return "unknown";
  }
  return "timestamp";
}

// ── Comparisons / IN / BETWEEN ───────────────────────────────────────────────

export function typeComparisonSides(
  node: {
    op: string;
    left: ScoutQlExprAst;
    right: ScoutQlExprAst;
    span: ScoutQlSpan;
  },
  ctx: ExprTypingContext,
  typer: ExprTyper,
): void {
  if (node.left.kind === "null" || node.right.kind === "null") {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message:
        "Comparisons with NULL are always NULL — use IS NULL / IS NOT NULL.",
      span: node.span,
    });
    return;
  }
  const left = typer.typeOfExpr(node.left, ctx);
  const right = typer.typeOfExpr(node.right, ctx);
  if (node.op === "like" || node.op === "ilike") {
    for (const side of [
      { expr: node.left, type: left },
      { expr: node.right, type: right },
    ]) {
      if (side.type !== "varchar" && side.type !== "unknown") {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message: `LIKE/ILIKE compares text; got ${side.type}.`,
          span: side.expr.span,
        });
      }
    }
    return;
  }
  if (!comparable(left, right)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: `Cannot compare ${left} with ${right}.`,
      span: node.span,
    });
  }
}

export function typeIn(
  node: Extract<ScoutQlExprAst, { kind: "in" }>,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  const operandType = typer.typeOfExpr(node.operand, ctx);
  if (node.items.length > 50) {
    emitDiagnostic(ctx.diagnostics, {
      code: "in-list-too-long",
      message: `IN lists are limited to 50 items (got ${String(node.items.length)}).`,
      span: node.span,
    });
  }
  let sawString = false;
  let sawNumber = false;
  for (const item of node.items) {
    const itemType = typer.typeOfExpr(item, ctx);
    const literal = inItemLiteral(item);
    if (literal === undefined) {
      if (!containsErrorNode(item)) {
        emitDiagnostic(ctx.diagnostics, {
          code: "type-mismatch",
          message:
            "IN lists take literal values (numbers, strings, or champion('…')).",
          span: item.span,
        });
      }
      continue;
    }
    if (typeof literal.value === "string") {
      sawString = true;
    } else {
      sawNumber = true;
    }
    if (!comparable(operandType, itemType)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "type-mismatch",
        message: `Cannot compare ${operandType} with ${itemType}.`,
        span: item.span,
      });
    }
  }
  // The engine binds an IN list as one typed array, so a mixed list has no
  // executable form — reject it here rather than letting the compiler throw.
  if (sawString && sawNumber) {
    emitDiagnostic(ctx.diagnostics, {
      code: "type-mismatch",
      message: "IN list items must be all strings or all numbers.",
      span: node.span,
    });
  }
  return "boolean";
}

export function typeBetween(
  node: Extract<ScoutQlExprAst, { kind: "between" }>,
  ctx: ExprTypingContext,
  typer: ExprTyper,
): ScoutQlExprType {
  const operandType = typer.typeOfExpr(node.operand, ctx);
  for (const bound of [node.low, node.high]) {
    const boundType = typer.typeOfExpr(bound, ctx);
    if (!comparable(operandType, boundType)) {
      emitDiagnostic(ctx.diagnostics, {
        code: "type-mismatch",
        message: `Cannot compare ${operandType} with ${boundType}.`,
        span: bound.span,
      });
    }
  }
  return "boolean";
}
