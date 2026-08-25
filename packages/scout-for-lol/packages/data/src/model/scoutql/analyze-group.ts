import type { ScoutQlExprAst } from "#src/model/scoutql/ast.ts";
import { sameExpr } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type {
  ScoutQlGrouping,
  ScoutQlGroupSize,
} from "#src/model/scoutql/plan.ts";
import { ScoutQlOutputNameSchema } from "#src/model/scoutql/expression.ts";
import type { SourceCatalog } from "#src/model/scoutql/catalog-columns.ts";
import {
  emitDiagnostic,
  forEachExprNode,
  type ExprTypingContext,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { typeOfExpr } from "#src/model/scoutql/analyze-expr.ts";
import { lowerScalar } from "#src/model/scoutql/analyze-lower.ts";

// ── GROUP BY resolution ──────────────────────────────────────────────────────
// Four grouping shapes, each of which the engine has a compiled arm for:
// a dimension column, DATE_TRUNC bucketing, a deterministic FLOOR bucket
// expression, and player_groups' `group(n|all)`.
//
// Naming (the key render encodings reference) resolves in this order:
//   1. a SELECT item that structurally echoes the grouping and carries `AS x` → x
//   2. an echo that is a bare column → the column name
//   3. derived from the shape — column name, or the DATE_TRUNC part ("week"),
//      or "group"
// A FLOOR-bucket expression has no honest derived name, so it must be echoed
// in SELECT with an alias; otherwise it is an `alias-required` error.

export type AnalyzedGrouping = {
  grouping: ScoutQlGrouping;
  span: ScoutQlSpan;
  ast: ScoutQlExprAst;
};

export type GroupSelectItem = {
  expr: ScoutQlExprAst;
  alias: string | null;
  span: ScoutQlSpan;
};

export type GroupAnalysisInput = {
  items: ScoutQlExprAst[];
  selectItems: GroupSelectItem[];
  typing: ExprTypingContext;
  catalog: SourceCatalog | undefined;
  diagnostics: ScoutQlDiagnostic[];
  clauseSpan: ScoutQlSpan;
};

type ScoutQlDateTruncPart = "day" | "week" | "month";

const DATE_TRUNC_PARTS: ReadonlyMap<string, ScoutQlDateTruncPart> = new Map([
  ["day", "day"],
  ["week", "week"],
  ["month", "month"],
]);

function echoName(
  expr: ScoutQlExprAst,
  selectItems: GroupSelectItem[],
): string | undefined {
  for (const item of selectItems) {
    if (!sameExpr(item.expr, expr)) {
      continue;
    }
    if (item.alias !== null) {
      return item.alias;
    }
    if (item.expr.kind === "column") {
      return item.expr.name;
    }
  }
  return undefined;
}

function containsNow(expr: ScoutQlExprAst): boolean {
  let found = false;
  forEachExprNode(expr, (node) => {
    if (node.kind === "now") {
      found = true;
    }
  });
  return found;
}

function isFloorCall(expr: ScoutQlExprAst): boolean {
  return expr.kind === "call" && expr.name === "floor";
}

/**
 * The engine only compiles deterministic FLOOR buckets: `FLOOR(x / w)`,
 * `FLOOR(x / w) * w`, or `w * FLOOR(x / w)`. Validated structurally here so
 * the compiler never has to refuse a plan it was handed.
 */
function isBucketExpression(expr: ScoutQlExprAst): boolean {
  if (containsNow(expr)) {
    return false;
  }
  if (isFloorCall(expr)) {
    return true;
  }
  return (
    expr.kind === "binary" &&
    expr.op === "*" &&
    ((isFloorCall(expr.left) && expr.right.kind === "number") ||
      (isFloorCall(expr.right) && expr.left.kind === "number"))
  );
}

/** `DATE_TRUNC('week', t)` / `DATE_TRUNC('week', t AT TIME ZONE 'Z')`. */
function dateTruncGrouping(
  expr: ScoutQlExprAst,
  name: string,
  input: GroupAnalysisInput,
): ScoutQlGrouping | undefined {
  if (expr.kind !== "call" || expr.name !== "date_trunc") {
    return undefined;
  }
  const [partAst, operandAst] = expr.args;
  if (operandAst === undefined || partAst?.kind !== "string") {
    return undefined;
  }
  const part = DATE_TRUNC_PARTS.get(partAst.value);
  if (part === undefined) {
    return undefined;
  }
  const zoned =
    operandAst.kind === "binary" && operandAst.op === "at-time-zone"
      ? { column: operandAst.left, timezone: operandAst.right }
      : { column: operandAst, timezone: undefined };
  if (zoned.column.kind !== "column") {
    emitDiagnostic(input.diagnostics, {
      code: "grouping-expression-invalid",
      message:
        "DATE_TRUNC bucketing groups a timestamp COLUMN, optionally AT TIME ZONE '…'.",
      span: expr.span,
    });
    return undefined;
  }
  const timezone =
    zoned.timezone?.kind === "string" ? zoned.timezone.value : "UTC";
  return {
    kind: "date-trunc",
    part,
    column: zoned.column.name,
    timezone,
    name,
  };
}

function groupCallSize(
  expr: ScoutQlExprAst,
  input: GroupAnalysisInput,
): ScoutQlGroupSize | undefined {
  if (expr.kind !== "call" || expr.name !== "group") {
    return undefined;
  }
  if (input.catalog !== undefined && !input.catalog.groupCall) {
    emitDiagnostic(input.diagnostics, {
      code: "group-call-unavailable",
      message: `GROUP BY group(…) is only available on player_groups, not ${input.catalog.id}.`,
      span: expr.span,
    });
    return undefined;
  }
  if (expr.all) {
    return "all";
  }
  const [size] = expr.args;
  if (
    size?.kind !== "number" ||
    !Number.isInteger(size.value) ||
    size.value < 2 ||
    size.value > 5
  ) {
    emitDiagnostic(input.diagnostics, {
      code: "function-arity",
      message: "group(…) takes a group size from 2 to 5, or `all`.",
      span: expr.span,
    });
    return undefined;
  }
  return size.value;
}

function derivedName(expr: ScoutQlExprAst): string | undefined {
  if (expr.kind === "column") {
    return expr.name;
  }
  if (expr.kind === "call") {
    if (expr.name === "group") {
      return "group";
    }
    if (expr.name === "date_trunc") {
      const [part] = expr.args;
      return part?.kind === "string" ? part.value : undefined;
    }
  }
  return undefined;
}

function resolveName(
  expr: ScoutQlExprAst,
  input: GroupAnalysisInput,
): string | undefined {
  const name = echoName(expr, input.selectItems) ?? derivedName(expr);
  if (name === undefined) {
    emitDiagnostic(input.diagnostics, {
      code: "alias-required",
      message:
        "Name this grouping by echoing it in SELECT with an alias, e.g. SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, …",
      span: expr.span,
    });
    return undefined;
  }
  if (!ScoutQlOutputNameSchema.safeParse(name).success) {
    emitDiagnostic(input.diagnostics, {
      code: "alias-invalid",
      message: `"${name}" is not a valid name — use lowercase letters, digits, and underscores, starting with a letter or underscore.`,
      span: expr.span,
    });
    return undefined;
  }
  return name;
}

function columnGrouping(
  expr: ScoutQlExprAst,
  name: string,
): ScoutQlGrouping | undefined {
  return expr.kind === "column"
    ? { kind: "column", column: expr.name, name }
    : undefined;
}

function expressionGrouping(
  expr: ScoutQlExprAst,
  name: string,
  input: GroupAnalysisInput,
): ScoutQlGrouping | undefined {
  if (!isBucketExpression(expr)) {
    emitDiagnostic(input.diagnostics, {
      code: "grouping-expression-invalid",
      message:
        "GROUP BY takes a dimension column, DATE_TRUNC('day'|'week'|'month', ts), group(n|all), or a FLOOR bucket like FLOOR(x / 300) * 300.",
      span: expr.span,
    });
    return undefined;
  }
  const lowered = lowerScalar(expr);
  return lowered === undefined
    ? undefined
    : { kind: "expression", expr: lowered, name };
}

function resolveGrouping(
  expr: ScoutQlExprAst,
  input: GroupAnalysisInput,
): AnalyzedGrouping | undefined {
  // group(…) is checked before typing: it is a GROUP-BY-only form, so the
  // expression typer would report it as an unavailable call a second time.
  if (expr.kind === "call" && expr.name === "group") {
    const size = groupCallSize(expr, input);
    return size === undefined
      ? undefined
      : {
          grouping: { kind: "group", size, name: "group" },
          span: expr.span,
          ast: expr,
        };
  }
  typeOfExpr(expr, input.typing);
  const name = resolveName(expr, input);
  if (name === undefined) {
    return undefined;
  }
  const grouping =
    columnGrouping(expr, name) ??
    dateTruncGrouping(expr, name, input) ??
    expressionGrouping(expr, name, input);
  return grouping === undefined
    ? undefined
    : { grouping, span: expr.span, ast: expr };
}

function checkGroupCallRules(
  groupings: AnalyzedGrouping[],
  input: GroupAnalysisInput,
): void {
  const groupCalls = groupings.filter(
    (analyzed) => analyzed.grouping.kind === "group",
  );
  if (groupCalls.length > 0 && groupings.length !== 1) {
    emitDiagnostic(input.diagnostics, {
      code: "group-call-unavailable",
      message: "group(…) cannot be combined with another grouping.",
      span: input.clauseSpan,
    });
    return;
  }
  if (groupCalls.length === 0 && input.catalog?.groupCall === true) {
    emitDiagnostic(input.diagnostics, {
      code: "group-call-unavailable",
      message:
        "player_groups reports teammate groups, so it requires GROUP BY group(2..5) or GROUP BY group(all).",
      span: input.clauseSpan,
    });
  }
}

export function analyzeGroupings(
  input: GroupAnalysisInput,
): AnalyzedGrouping[] {
  if (input.items.length > 3) {
    emitDiagnostic(input.diagnostics, {
      code: "grouping-count",
      message: `A query may group by at most 3 dimensions (got ${String(input.items.length)}).`,
      span: input.clauseSpan,
    });
  }
  const groupings: AnalyzedGrouping[] = [];
  const seen = new Set<string>();
  for (const item of input.items.slice(0, 3)) {
    const analyzed = resolveGrouping(item, input);
    if (analyzed === undefined) {
      continue;
    }
    if (seen.has(analyzed.grouping.name)) {
      emitDiagnostic(input.diagnostics, {
        code: "alias-duplicate",
        message: `Two groupings are both named "${analyzed.grouping.name}".`,
        span: analyzed.span,
      });
      continue;
    }
    seen.add(analyzed.grouping.name);
    groupings.push(analyzed);
  }
  checkGroupCallRules(groupings, input);
  return groupings;
}
