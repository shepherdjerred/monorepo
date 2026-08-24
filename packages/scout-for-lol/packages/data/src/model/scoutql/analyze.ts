import type {
  ScoutQlExprAst,
  ScoutQlQueryAst,
} from "#src/model/scoutql/ast.ts";
import type { ScoutQlDiagnostic } from "#src/model/scoutql/diagnostics.ts";
import {
  DEFAULT_RENDER_SPEC,
  REPORT_DEFAULT_MAX_ROWS,
  type ReportRenderSpec,
} from "#src/model/report.ts";
import type {
  ScoutQlHavingPredicate,
  ScoutQlPredicate,
} from "#src/model/scoutql/expression.ts";
import type {
  ScoutQlOrderKey,
  ScoutQlTimeWindow,
} from "#src/model/scoutql/plan.ts";
import {
  parseScoutQl,
  type ScoutQlParseResult,
} from "#src/model/scoutql/parse.ts";
import {
  scoutQlSourceCatalog,
  scoutQlSourceCatalogs,
  type SourceCatalog,
} from "#src/model/scoutql/catalog-columns.ts";
import { closestScoutQlName } from "#src/model/scoutql/catalog-functions.ts";
import {
  emitDiagnostic,
  type ExprTypingContext,
  type ScoutQlExprType,
} from "#src/model/scoutql/analyze-expr-shared.ts";
import { PlayerRefCollector } from "#src/model/scoutql/analyze-lower.ts";
import {
  analyzeGroupings,
  type AnalyzedGrouping,
} from "#src/model/scoutql/analyze-group.ts";
import {
  analyzeOutputs,
  groupByAllItems,
  type AnalyzedOutput,
} from "#src/model/scoutql/analyze-select.ts";
import {
  analyzeHaving,
  analyzeOrderBy,
} from "#src/model/scoutql/analyze-order.ts";
import { analyzeWhere } from "#src/model/scoutql/analyze-where.ts";
import {
  analyzeRender,
  isChartRenderKind,
} from "#src/model/scoutql/analyze-render.ts";

// ── analyzeScoutQl — one parse, every semantic answer ────────────────────────
// Never throws. Runs the passes in dependency order (groupings → outputs →
// WHERE → HAVING → ORDER BY → RENDER → limits) and returns everything the
// compiler, the editor services, and the AI validate tool need, with parse and
// semantic diagnostics merged into one span-ordered list.

export type ScoutQlAnalysis = {
  parse: ScoutQlParseResult;
  source: SourceCatalog | undefined;
  outputs: AnalyzedOutput[];
  groupings: AnalyzedGrouping[];
  timeWindow: ScoutQlTimeWindow;
  /** Residual predicate — recognized time/competition conjuncts hoisted out. */
  where: ScoutQlPredicate | undefined;
  having: ScoutQlHavingPredicate | undefined;
  orderBy: ScoutQlOrderKey[];
  limit: number;
  playerRefs: string[];
  competitionId: number | undefined;
  render: ReportRenderSpec;
  diagnostics: ScoutQlDiagnostic[];
};

/** Rows a charted time series needs before the renderer downsamples it. */
const TEMPORAL_ROW_BUDGET = 2000;

function resolveSource(
  ast: ScoutQlQueryAst,
  diagnostics: ScoutQlDiagnostic[],
): SourceCatalog | undefined {
  if (ast.from === undefined) {
    return undefined;
  }
  const catalog = scoutQlSourceCatalog(ast.from.source);
  if (catalog !== undefined) {
    return catalog;
  }
  const names = scoutQlSourceCatalogs().map((candidate) => candidate.id);
  const suggestion = closestScoutQlName(ast.from.source, names);
  emitDiagnostic(diagnostics, {
    code: "unknown-source",
    message: `"${ast.from.source}" is not a ScoutQL source.${suggestion === undefined ? ` Available: ${names.join(", ")}.` : ` Did you mean "${suggestion}"?`}`,
    span: ast.from.span,
  });
  return undefined;
}

/**
 * DuckDB allows GROUP BY to name a SELECT alias; the grouping then means that
 * alias's expression. Resolved before analysis so the grouping is the real
 * shape rather than a column nobody has.
 */
function resolveGroupByAliases(
  items: ScoutQlExprAst[],
  ast: ScoutQlQueryAst,
  catalog: SourceCatalog | undefined,
): ScoutQlExprAst[] {
  const selectItems = ast.select?.items ?? [];
  return items.map((item) => {
    if (item.kind !== "column" || catalog?.columns.has(item.name) === true) {
      return item;
    }
    const aliased = selectItems.find(
      (candidate) => candidate.alias === item.name,
    );
    return aliased === undefined ? item : aliased.expr;
  });
}

function resolveLimit(
  ast: ScoutQlQueryAst,
  groupings: AnalyzedGrouping[],
  render: ReportRenderSpec,
  diagnostics: ScoutQlDiagnostic[],
): number {
  if (ast.limit !== undefined) {
    const { value } = ast.limit;
    if (!Number.isInteger(value) || value <= 0) {
      emitDiagnostic(diagnostics, {
        code: "limit-invalid",
        message: `LIMIT takes a positive whole number of rows (got ${String(value)}).`,
        span: ast.limit.span,
      });
      return REPORT_DEFAULT_MAX_ROWS;
    }
    return value;
  }
  // Matches the engine's own definition of "temporal" (temporal-plan.ts's
  // `planTemporalGrouping`): DATE_TRUNC bucketing, or the `patch` dimension,
  // which buckets by patch instead of by time but is still a chart axis with
  // as many points as there are patches in range. Omitting `patch` here would
  // compile a smaller default LIMIT into the plan than the engine's own
  // temporal row budget — a default `effectiveRowLimit` can only shrink
  // afterward, never restore.
  const temporal = groupings.some(
    (grouping) =>
      grouping.grouping.kind === "date-trunc" ||
      (grouping.grouping.kind === "column" &&
        grouping.grouping.column === "patch"),
  );
  return temporal && isChartRenderKind(render.kind)
    ? TEMPORAL_ROW_BUDGET
    : REPORT_DEFAULT_MAX_ROWS;
}

/**
 * Where the "add a time bound" quick fix inserts, and whether the insertion
 * needs the existing predicate parenthesized: appending `AND …` to a top-level
 * OR would bind to its right operand only and quietly change the question.
 */
function timeBoundAnchor(ast: ScoutQlQueryAst): {
  span: { start: number; end: number };
  insertAt: number;
} {
  const fallback = ast.from?.span ?? ast.span;
  const where = ast.where;
  return {
    span: fallback,
    insertAt: where === undefined ? fallback.end : where.span.end,
  };
}

function sortDiagnostics(
  diagnostics: ScoutQlDiagnostic[],
): ScoutQlDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    if (left.span.start !== right.span.start) {
      return left.span.start - right.span.start;
    }
    if (left.span.end !== right.span.end) {
      return left.span.end - right.span.end;
    }
    return left.code.localeCompare(right.code);
  });
}

export function analyzeScoutQl(text: string): ScoutQlAnalysis {
  const parse = parseScoutQl(text);
  const diagnostics: ScoutQlDiagnostic[] = [];
  const { ast } = parse;
  const catalog = resolveSource(ast, diagnostics);
  const refs = new PlayerRefCollector();
  const emptyAliases: ReadonlyMap<string, ScoutQlExprType> = new Map();

  const baseTyping: ExprTypingContext = {
    catalog,
    clause: "select",
    outputAliases: emptyAliases,
    allowPlayerRef: false,
    diagnostics,
  };

  const selectItems = ast.select?.items ?? [];
  const groupByAst = ast.groupBy;
  const rawGroupItems =
    groupByAst === undefined
      ? []
      : groupByAst.all
        ? groupByAllItems(selectItems)
        : groupByAst.items;
  const groupItems = resolveGroupByAliases(rawGroupItems, ast, catalog);

  const groupings = analyzeGroupings({
    items: groupItems,
    selectItems: selectItems.map((item) => ({
      expr: item.expr,
      alias: item.alias,
      span: item.span,
    })),
    typing: { ...baseTyping, clause: "group" },
    catalog,
    diagnostics,
    clauseSpan: groupByAst?.span ?? ast.from?.span ?? ast.span,
  });

  const outputs = analyzeOutputs({
    items: selectItems,
    groupings,
    hasGroupBy: groupByAst !== undefined,
    typing: baseTyping,
    refs,
    diagnostics,
    clauseSpan: ast.select?.span ?? ast.span,
  });

  const outputTypes: ReadonlyMap<string, ScoutQlExprType> = new Map(
    outputs.map((output) => [output.name, output.type]),
  );

  const where = analyzeWhere({
    clause: ast.where,
    catalog,
    typing: {
      ...baseTyping,
      clause: "where",
      outputAliases: outputTypes,
      allowPlayerRef: catalog?.playerRefAllowed ?? false,
    },
    refs,
    diagnostics,
    anchor: timeBoundAnchor(ast),
  });

  const having =
    ast.having === undefined
      ? undefined
      : analyzeHaving({
          expr: ast.having.expr,
          outputs,
          typing: baseTyping,
          refs,
          diagnostics,
        });

  const orderBy =
    ast.orderBy === undefined
      ? []
      : analyzeOrderBy({
          clause: ast.orderBy,
          outputs,
          groupings,
          diagnostics,
        });

  const render =
    ast.render === undefined
      ? DEFAULT_RENDER_SPEC
      : (analyzeRender({
          clause: ast.render,
          outputs,
          groupings,
          timeWindow: where.timeWindow,
          residualTouchesTime: where.residualTouchesTime,
          diagnostics,
        }) ?? DEFAULT_RENDER_SPEC);

  const limit = resolveLimit(ast, groupings, render, diagnostics);

  // Backstop: every output that types cleanly must also have a plan-IR
  // representation. If some shape is expressible in the grammar, survives
  // typing, and still cannot be lowered, the author gets a coded, spanned
  // refusal here rather than an internal error from the compiler.
  for (const output of outputs) {
    if (output.expr !== undefined) continue;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      break;
    }
    diagnostics.push({
      code: "expression-unsupported",
      message: `Output "${output.name}" uses an expression ScoutQL cannot execute. Rewrite it with the documented aggregate, scalar, and comparison forms.`,
      severity: "error",
      span: output.span,
    });
  }

  return {
    parse,
    source: catalog,
    outputs,
    groupings,
    timeWindow: where.timeWindow,
    where: where.where,
    having,
    orderBy,
    limit,
    playerRefs: refs.names,
    competitionId: where.competitionId,
    render,
    diagnostics: sortDiagnostics([...parse.diagnostics, ...diagnostics]),
  };
}
