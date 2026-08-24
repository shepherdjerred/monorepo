import { match } from "ts-pattern";
import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlDiagnosticCode,
  ScoutQlFix,
  ScoutQlSeverity,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlCastType,
  ScoutQlIntervalUnit,
} from "#src/model/scoutql/expression.ts";
import {
  ScoutQlCastTypeSchema,
  ScoutQlIntervalUnitSchema,
} from "#src/model/scoutql/expression.ts";
import type {
  ScoutQlColumnInfo,
  SourceCatalog,
} from "#src/model/scoutql/catalog-columns.ts";
import { resolveReportChampion } from "#src/model/report-query-champions.ts";

// ── Expression-analysis shared vocabulary ────────────────────────────────────
// The type lattice, the diagnostic emitter, the AST walkers, and the small
// normalizers every typing module needs. Recursion between the typing modules
// travels through the `ExprTyper` port rather than an import cycle: atoms and
// calls receive the typer, and analyze-expr.ts closes the loop.

export type ScoutQlExprType =
  | "boolean"
  | "integer"
  | "double"
  | "varchar"
  | "timestamp"
  | "date"
  | "interval"
  | "null"
  | "unknown";

export type ScoutQlExprClause =
  "select" | "where" | "filter" | "group" | "having";

export type ExprTypingContext = {
  catalog: SourceCatalog | undefined;
  clause: ScoutQlExprClause;
  /** Output aliases with their types (WHERE→HAVING hint; HAVING refs). */
  outputAliases: ReadonlyMap<string, ScoutQlExprType>;
  /** Whether `player('…')` atoms are legal here. */
  allowPlayerRef: boolean;
  diagnostics: ScoutQlDiagnostic[];
  inAggregate?: boolean | undefined;
};

/** Recursion port: how a sub-module re-enters the two typing entry points. */
export type ExprTyper = {
  typeOfExpr: (expr: ScoutQlExprAst, ctx: ExprTypingContext) => ScoutQlExprType;
  typeConditionExpr: (expr: ScoutQlExprAst, ctx: ExprTypingContext) => void;
};

type DiagnosticInput = {
  code: ScoutQlDiagnosticCode;
  message: string;
  span: ScoutQlSpan;
  severity?: ScoutQlSeverity;
  fixes?: ScoutQlFix[];
};

export function emitDiagnostic(
  diagnostics: ScoutQlDiagnostic[],
  input: DiagnosticInput,
): void {
  diagnostics.push({
    code: input.code,
    message: input.message,
    severity: input.severity ?? "error",
    span: input.span,
    ...(input.fixes === undefined ? {} : { fixes: input.fixes }),
  });
}

// ── AST walkers ──────────────────────────────────────────────────────────────

/** Visit every node (pre-order), including IN items and FILTER bodies. */
export function forEachExprNode(
  expr: ScoutQlExprAst,
  visit: (node: ScoutQlExprAst) => void,
): void {
  visit(expr);
  match(expr)
    .with(
      { kind: "column" },
      { kind: "number" },
      { kind: "string" },
      { kind: "boolean" },
      { kind: "null" },
      { kind: "interval" },
      { kind: "now" },
      { kind: "error" },
      () => {
        // Leaf.
      },
    )
    .with({ kind: "unary" }, (node) => {
      forEachExprNode(node.operand, visit);
    })
    .with({ kind: "binary" }, (node) => {
      forEachExprNode(node.left, visit);
      forEachExprNode(node.right, visit);
    })
    .with({ kind: "cast" }, { kind: "is-null" }, (node) => {
      forEachExprNode(node.operand, visit);
    })
    .with({ kind: "in" }, (node) => {
      forEachExprNode(node.operand, visit);
      for (const item of node.items) {
        forEachExprNode(item, visit);
      }
    })
    .with({ kind: "between" }, (node) => {
      forEachExprNode(node.operand, visit);
      forEachExprNode(node.low, visit);
      forEachExprNode(node.high, visit);
    })
    .with({ kind: "call" }, (node) => {
      for (const arg of node.args) {
        forEachExprNode(arg, visit);
      }
      if (node.filter !== undefined) {
        forEachExprNode(node.filter, visit);
      }
    })
    .exhaustive();
}

/** Aggregate functions and the aggregate macros, by surface name. */
export const SCOUTQL_AGGREGATE_NAMES: ReadonlySet<string> = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "quantile_cont",
  "stddev",
  "kda",
  "per_minute",
]);

/** Whether the expression contains an aggregate (or aggregate macro) call. */
export function exprContainsAggregate(expr: ScoutQlExprAst): boolean {
  let found = false;
  forEachExprNode(expr, (node) => {
    if (node.kind === "call" && SCOUTQL_AGGREGATE_NAMES.has(node.name)) {
      found = true;
    }
  });
  return found;
}

export function containsErrorNode(expr: ScoutQlExprAst): boolean {
  let found = false;
  forEachExprNode(expr, (node) => {
    if (node.kind === "error") {
      found = true;
    }
  });
  return found;
}

export function collectAstColumnNames(expr: ScoutQlExprAst): Set<string> {
  const names = new Set<string>();
  forEachExprNode(expr, (node) => {
    if (node.kind === "column") {
      names.add(node.name);
    }
  });
  return names;
}

// ── Small normalizers ────────────────────────────────────────────────────────

export function normalizeIntervalUnit(
  unit: string | null,
): ScoutQlIntervalUnit | undefined {
  if (unit === null) {
    return undefined;
  }
  const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit;
  const parsed = ScoutQlIntervalUnitSchema.safeParse(singular);
  return parsed.success ? parsed.data : undefined;
}

export function normalizeCastType(to: string): ScoutQlCastType | undefined {
  const name = to === "integer" ? "int" : to;
  const parsed = ScoutQlCastTypeSchema.safeParse(name);
  return parsed.success ? parsed.data : undefined;
}

export function castResultType(to: ScoutQlCastType): ScoutQlExprType {
  return match(to)
    .with("int", "bigint", (): ScoutQlExprType => "integer")
    .with("double", (): ScoutQlExprType => "double")
    .with("date", (): ScoutQlExprType => "date")
    .with("timestamp", (): ScoutQlExprType => "timestamp")
    .with("varchar", (): ScoutQlExprType => "varchar")
    .exhaustive();
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function columnExprType(column: ScoutQlColumnInfo): ScoutQlExprType {
  return match(column.type)
    .with("integer", "bigint", (): ScoutQlExprType => "integer")
    .with("double", (): ScoutQlExprType => "double")
    .with("varchar", (): ScoutQlExprType => "varchar")
    .with("boolean", (): ScoutQlExprType => "boolean")
    .with("timestamp", (): ScoutQlExprType => "timestamp")
    .exhaustive();
}

export function isNumeric(type: ScoutQlExprType): boolean {
  return type === "integer" || type === "double";
}

function isTemporal(type: ScoutQlExprType): boolean {
  return type === "timestamp" || type === "date";
}

/** DuckDB comparison compatibility, including its implicit temporal casts. */
export function comparable(a: ScoutQlExprType, b: ScoutQlExprType): boolean {
  if (a === "unknown" || b === "unknown" || a === b) {
    return true;
  }
  if (isNumeric(a) && isNumeric(b)) {
    return true;
  }
  if (isTemporal(a) && isTemporal(b)) {
    return true;
  }
  return (
    (isTemporal(a) && b === "varchar") || (isTemporal(b) && a === "varchar")
  );
}

// ── player('…') shapes ───────────────────────────────────────────────────────

export type PlayerRefShape = { name: string; span: ScoutQlSpan };

function barePlayerCall(expr: ScoutQlExprAst): PlayerRefShape | undefined {
  if (
    expr.kind === "call" &&
    expr.name === "player" &&
    !expr.star &&
    !expr.distinct &&
    !expr.all &&
    expr.filter === undefined &&
    expr.args.length === 1
  ) {
    const [arg] = expr.args;
    if (arg?.kind === "string") {
      return { name: arg.value, span: expr.span };
    }
  }
  return undefined;
}

/**
 * The two accepted `player('…')` condition shapes: a bare call, and the
 * legacy-familiar `player = player('…')` comparison. Both lift the name into
 * `plan.playerRefs` and leave a `player-ref` node behind.
 */
export function playerRefShape(
  expr: ScoutQlExprAst,
): PlayerRefShape | undefined {
  const bare = barePlayerCall(expr);
  if (bare !== undefined) {
    return bare;
  }
  if (expr.kind === "binary" && expr.op === "=") {
    const sides = [
      { column: expr.left, call: expr.right },
      { column: expr.right, call: expr.left },
    ];
    for (const side of sides) {
      const call = barePlayerCall(side.call);
      if (
        call !== undefined &&
        side.column.kind === "column" &&
        side.column.name === "player"
      ) {
        return { name: call.name, span: expr.span };
      }
    }
  }
  return undefined;
}

/**
 * Literal-ish IN item: number, string, -number, or a `champion('…')` call
 * that constant-folds to its numeric id.
 */
export function inItemLiteral(
  item: ScoutQlExprAst,
): { value: number | string } | undefined {
  if (item.kind === "number") {
    return { value: item.value };
  }
  if (item.kind === "string") {
    return { value: item.value };
  }
  if (
    item.kind === "unary" &&
    item.op === "-" &&
    item.operand.kind === "number"
  ) {
    return { value: -item.operand.value };
  }
  if (
    item.kind === "call" &&
    item.name === "champion" &&
    item.args.length === 1 &&
    item.args[0]?.kind === "string"
  ) {
    const champion = resolveReportChampion(item.args[0].value);
    if (champion !== undefined) {
      return { value: champion.id };
    }
  }
  return undefined;
}
