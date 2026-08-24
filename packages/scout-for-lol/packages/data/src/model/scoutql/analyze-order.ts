import type {
  ScoutQlExprAst,
  ScoutQlOrderByClauseAst,
} from "#src/model/scoutql/ast.ts";
import { sameExpr } from "#src/model/scoutql/ast.ts";
import type { ScoutQlDiagnostic } from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlOrderKey } from "#src/model/scoutql/plan.ts";
import type { ScoutQlHavingPredicate } from "#src/model/scoutql/expression.ts";
import { closestScoutQlName } from "#src/model/scoutql/catalog-functions.ts";
import {
  emitDiagnostic,
  type ExprTypingContext,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { typeConditionExpr } from "#src/model/scoutql/analyze-expr.ts";
import type { AnalyzedGrouping } from "#src/model/scoutql/analyze-group.ts";
import type { AnalyzedOutput } from "#src/model/scoutql/analyze-select.ts";
import type { PlayerRefCollector } from "#src/model/scoutql/analyze-lower.ts";
import { lowerHaving } from "#src/model/scoutql/analyze-lower-aggregate.ts";

// ── HAVING and ORDER BY ──────────────────────────────────────────────────────
// Both see the aggregated result, so both may reference outputs by alias
// (DuckDB semantics) as well as aggregate expressions; ORDER BY may also name
// a grouping. Anything else is a coded, spanned error rather than a silent
// fallback to "first column".

const MAX_ORDER_KEYS = 3;

export type HavingInput = {
  expr: ScoutQlExprAst;
  outputs: AnalyzedOutput[];
  typing: ExprTypingContext;
  refs: PlayerRefCollector;
  diagnostics: ScoutQlDiagnostic[];
};

export function analyzeHaving(
  input: HavingInput,
): ScoutQlHavingPredicate | undefined {
  const outputTypes = new Map(
    input.outputs.map((output) => [output.name, output.type]),
  );
  typeConditionExpr(input.expr, {
    ...input.typing,
    clause: "having",
    outputAliases: outputTypes,
    allowPlayerRef: false,
  });
  return lowerHaving(input.expr, {
    refs: input.refs,
    outputNames: new Set(outputTypes.keys()),
  });
}

export type OrderInput = {
  clause: ScoutQlOrderByClauseAst;
  outputs: AnalyzedOutput[];
  groupings: AnalyzedGrouping[];
  diagnostics: ScoutQlDiagnostic[];
};

function resolveTarget(
  expr: ScoutQlExprAst,
  input: OrderInput,
): ScoutQlOrderKey["target"] | undefined {
  if (expr.kind === "column") {
    if (input.outputs.some((output) => output.name === expr.name)) {
      return { kind: "output", name: expr.name };
    }
    const groupingIndex = input.groupings.findIndex(
      (grouping) => grouping.grouping.name === expr.name,
    );
    if (groupingIndex !== -1) {
      return { kind: "grouping", index: groupingIndex };
    }
  }
  const structuralGrouping = input.groupings.findIndex((grouping) =>
    sameExpr(grouping.ast, expr),
  );
  if (structuralGrouping !== -1) {
    return { kind: "grouping", index: structuralGrouping };
  }
  const output = input.outputs.find((candidate) =>
    sameExpr(candidate.ast, expr),
  );
  if (output !== undefined) {
    return { kind: "output", name: output.name };
  }
  return undefined;
}

export function analyzeOrderBy(input: OrderInput): ScoutQlOrderKey[] {
  if (input.clause.keys.length > MAX_ORDER_KEYS) {
    emitDiagnostic(input.diagnostics, {
      code: "order-key-count",
      message: `ORDER BY takes at most ${String(MAX_ORDER_KEYS)} keys (got ${String(input.clause.keys.length)}).`,
      span: input.clause.span,
    });
  }
  const keys: ScoutQlOrderKey[] = [];
  for (const key of input.clause.keys.slice(0, MAX_ORDER_KEYS)) {
    if (key.expr.kind === "error") {
      continue;
    }
    const target = resolveTarget(key.expr, input);
    if (target === undefined) {
      const candidates = [
        ...input.outputs.map((output) => output.name),
        ...input.groupings.map((grouping) => grouping.grouping.name),
      ];
      const shown =
        key.expr.kind === "column" ? key.expr.name : "this expression";
      const suggestion =
        key.expr.kind === "column"
          ? closestScoutQlName(key.expr.name, candidates)
          : undefined;
      emitDiagnostic(input.diagnostics, {
        code: "order-target-unknown",
        message: `ORDER BY ${shown} does not name an output or a grouping.${suggestion === undefined ? ` Available: ${candidates.join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
        span: key.span,
      });
      continue;
    }
    keys.push({ target, direction: key.direction ?? "asc" });
  }
  return keys;
}
