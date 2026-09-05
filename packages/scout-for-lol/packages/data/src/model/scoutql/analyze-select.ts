import type {
  ScoutQlExprAst,
  ScoutQlSelectItemAst,
} from "#src/model/scoutql/ast.ts";
import { sameExpr } from "#src/model/scoutql/ast.ts";
import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type { ReportDisplayKind } from "#src/model/reports/report.ts";
import type { ScoutQlOutputExpr } from "#src/model/scoutql/plan.ts";
import type { ScoutQlEvidence } from "#src/model/scoutql/expression.ts";
import { ScoutQlOutputNameSchema } from "#src/model/scoutql/expression.ts";
import {
  emitDiagnostic,
  exprContainsAggregate,
  type ExprTypingContext,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { typeOfExpr } from "#src/model/scoutql/analyze-expr.ts";
import type { AnalyzedGrouping } from "#src/model/scoutql/analyze-group.ts";
import type { PlayerRefCollector } from "#src/model/scoutql/analyze-lower.ts";
import { lowerAggregate } from "#src/model/scoutql/analyze-lower-aggregate.ts";
import {
  inferDisplayKind,
  inferEvidence,
  isAdditive,
} from "#src/model/scoutql/analyze-display.ts";
import { deriveOutputName } from "#src/model/scoutql/analyze-names.ts";

// ── SELECT analysis: aggregation context, names, and output IR ───────────────
// Real SQL aggregation rules, not conveniences:
//
// - With GROUP BY, a raw (non-aggregate) SELECT item must structurally match a
//   grouping — that is what makes it single-valued per row.
// - Without GROUP BY, an aggregate anywhere makes the query a grand total, so
//   every output must be an aggregate.
// - Any computed output needs a name, because render encodings and HAVING /
//   ORDER BY reference outputs by name.

export type AnalyzedOutput = {
  name: string;
  span: ScoutQlSpan;
  /** The surface expression, kept for ORDER BY matching and editor services. */
  ast: ScoutQlExprAst;
  type: ScoutQlExprType;
  displayKind: ReportDisplayKind;
  additive: boolean;
  /** False for a grouping echo (`SELECT week, …`). */
  aggregate: boolean;
  evidence: ScoutQlEvidence;
  /** Compiled IR; undefined only alongside an error diagnostic. */
  expr: ScoutQlOutputExpr | undefined;
};

export type SelectAnalysisInput = {
  items: ScoutQlSelectItemAst[];
  groupings: AnalyzedGrouping[];
  /** A GROUP BY clause is present (including GROUP BY ALL). */
  hasGroupBy: boolean;
  typing: ExprTypingContext;
  refs: PlayerRefCollector;
  diagnostics: ScoutQlDiagnostic[];
  clauseSpan: ScoutQlSpan;
};

const MAX_OUTPUTS = 20;

function groupingDisplayKind(
  grouping: AnalyzedGrouping,
  typing: ExprTypingContext,
): ReportDisplayKind {
  switch (grouping.grouping.kind) {
    case "date-trunc":
      return "timestamp";
    case "expression":
      return "decimal";
    case "group":
      return "text";
    case "column":
      return (
        typing.catalog?.columns.get(grouping.grouping.column)?.displayKind ??
        "text"
      );
  }
}

/** Which grouping a raw SELECT item echoes — by structure, or by its name. */
function matchingGroupingIndex(
  expr: ScoutQlExprAst,
  groupings: AnalyzedGrouping[],
): number | undefined {
  const structural = groupings.findIndex((grouping) =>
    sameExpr(grouping.ast, expr),
  );
  if (structural !== -1) {
    return structural;
  }
  if (expr.kind === "column") {
    const named = groupings.findIndex(
      (grouping) => grouping.grouping.name === expr.name,
    );
    if (named !== -1) {
      return named;
    }
  }
  return undefined;
}

function aliasFix(item: ScoutQlSelectItemAst): {
  title: string;
  edits: { start: number; end: number; newText: string }[];
}[] {
  const name = deriveOutputName(item.expr);
  return [
    {
      title: `Name this output AS ${name}`,
      edits: [
        {
          start: item.expr.span.end,
          end: item.expr.span.end,
          newText: ` AS ${name}`,
        },
      ],
    },
  ];
}

function outputName(
  item: ScoutQlSelectItemAst,
  input: SelectAnalysisInput,
): string | undefined {
  if (item.alias === null) {
    if (item.expr.kind === "column") {
      return item.expr.name;
    }
    if (item.expr.kind === "error") {
      return undefined;
    }
    emitDiagnostic(input.diagnostics, {
      code: "alias-required",
      message:
        "Name this output with AS — render encodings, HAVING, and ORDER BY reference outputs by name.",
      span: item.span,
      fixes: aliasFix(item),
    });
    return undefined;
  }
  if (!ScoutQlOutputNameSchema.safeParse(item.alias).success) {
    emitDiagnostic(input.diagnostics, {
      code: "alias-invalid",
      message: `"${item.alias}" is not a valid output name — use lowercase letters, digits, and underscores, starting with a letter or underscore, up to 64 characters.`,
      span: item.aliasSpan ?? item.span,
    });
    return undefined;
  }
  return item.alias;
}

function rawOutputExpr(
  item: ScoutQlSelectItemAst,
  name: string,
  input: SelectAnalysisInput,
): {
  expr: ScoutQlOutputExpr | undefined;
  grouping: AnalyzedGrouping | undefined;
} {
  if (!input.hasGroupBy) {
    emitDiagnostic(input.diagnostics, {
      code: "column-not-grouped",
      message: `This query has no GROUP BY, so it computes one grand-total row — every output must be an aggregate. Wrap "${name}" in an aggregate, or add GROUP BY ${name}.`,
      span: item.span,
    });
    return { expr: undefined, grouping: undefined };
  }
  const index = matchingGroupingIndex(item.expr, input.groupings);
  const grouping = index === undefined ? undefined : input.groupings[index];
  if (index === undefined || grouping === undefined) {
    emitDiagnostic(input.diagnostics, {
      code: "column-not-grouped",
      message: `"${name}" is neither grouped nor aggregated. Add it to GROUP BY, or aggregate it (e.g. MAX(${name})).`,
      span: item.span,
    });
    return { expr: undefined, grouping: undefined };
  }
  return { expr: { kind: "grouping-ref", index }, grouping };
}

function analyzeItem(
  item: ScoutQlSelectItemAst,
  input: SelectAnalysisInput,
): AnalyzedOutput | undefined {
  const type = typeOfExpr(item.expr, input.typing);
  const name = outputName(item, input);
  if (name === undefined) {
    return undefined;
  }
  const aggregate = exprContainsAggregate(item.expr);
  if (!aggregate) {
    const raw = rawOutputExpr(item, name, input);
    return {
      name,
      span: item.span,
      ast: item.expr,
      type,
      displayKind:
        raw.grouping === undefined
          ? "text"
          : groupingDisplayKind(raw.grouping, input.typing),
      additive: false,
      aggregate: false,
      evidence: { kind: "sample" },
      expr: raw.expr,
    };
  }
  // A SELECT output may not reference another output by alias, so the lowering
  // context carries no output names — an alias inside one is an unknown column.
  const expr = lowerAggregate(item.expr, {
    refs: input.refs,
    outputNames: new Set(),
  });
  return {
    name,
    span: item.span,
    ast: item.expr,
    type,
    displayKind: inferDisplayKind(item.expr, input.typing),
    additive: isAdditive(item.expr),
    aggregate: true,
    evidence: inferEvidence(item.expr, {
      typing: input.typing,
      refs: input.refs,
    }),
    expr,
  };
}

export function analyzeOutputs(input: SelectAnalysisInput): AnalyzedOutput[] {
  if (input.items.length > MAX_OUTPUTS) {
    emitDiagnostic(input.diagnostics, {
      code: "output-count",
      message: `A query may SELECT at most ${String(MAX_OUTPUTS)} outputs (got ${String(input.items.length)}).`,
      span: input.clauseSpan,
    });
  }
  if (input.items.length === 0) {
    emitDiagnostic(input.diagnostics, {
      code: "output-count",
      message: "SELECT needs at least one output.",
      span: input.clauseSpan,
    });
    return [];
  }
  const outputs: AnalyzedOutput[] = [];
  const seen = new Set<string>();
  for (const item of input.items.slice(0, MAX_OUTPUTS)) {
    const output = analyzeItem(item, input);
    if (output === undefined) {
      continue;
    }
    if (seen.has(output.name)) {
      emitDiagnostic(input.diagnostics, {
        code: "alias-duplicate",
        message: `Two outputs are both named "${output.name}".`,
        span: output.span,
      });
      continue;
    }
    seen.add(output.name);
    outputs.push(output);
  }
  return outputs;
}

// ── GROUP BY ALL ─────────────────────────────────────────────────────────────

/**
 * DuckDB's GROUP BY ALL: every SELECT expression that is not an aggregate
 * becomes a grouping, in SELECT order.
 */
export function groupByAllItems(
  items: ScoutQlSelectItemAst[],
): ScoutQlExprAst[] {
  return items
    .filter(
      (item) => item.expr.kind !== "error" && !exprContainsAggregate(item.expr),
    )
    .map((item) => item.expr);
}
