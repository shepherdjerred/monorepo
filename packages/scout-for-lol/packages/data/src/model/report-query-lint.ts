import { z } from "zod";
import {
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportSourceSchema,
  type ReportDiagnostic,
  type ReportQueryAst,
  type ReportQuerySpan,
  type ReportWhereClause,
} from "#src/model/report-query-spec.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
import {
  compileReportHaving,
  groupingColumnNames,
  parseGroupByClauses,
} from "#src/model/report-query-compile.ts";
import { parseRenderClause } from "#src/model/report-query-render.ts";
import { parseReportSelectItem } from "#src/model/report-query-expression.ts";
import { tokenizeReportQuery } from "#src/model/report-query-lexer.ts";
import { QueueTypeSchema } from "#src/model/state.ts";

const PositiveIntSchema = z.coerce.number().int().positive();

function error(message: string, span: ReportQuerySpan): ReportDiagnostic {
  return { message, severity: "error", span };
}

function warning(message: string, span: ReportQuerySpan): ReportDiagnostic {
  return { message, severity: "warning", span };
}

// Lints query text: lexer errors + structural parse diagnostics + semantic
// checks (unknown sources/metrics/fields/queues, bad numbers). Pure; used by the
// Monaco diagnostics provider. Unknown queue values are warnings (the executor
// accepts any string but they match no games).
export function lintReportQuery(text: string): ReportDiagnostic[] {
  const lex = tokenizeReportQuery(text);
  const diagnostics: ReportDiagnostic[] = lex.errors.map((lexError) =>
    error(lexError.message, {
      start: lexError.offset,
      end: lexError.offset + Math.max(lexError.length, 1),
    }),
  );

  const { ast, diagnostics: parseDiagnostics } = parseReportQuery(text);
  diagnostics.push(...parseDiagnostics);
  diagnostics.push(...sourceAndGroupDiagnostics(ast));
  diagnostics.push(...metricDiagnostics(ast));
  diagnostics.push(...orderAndLimitDiagnostics(ast));
  diagnostics.push(...whereDiagnostics(ast.where));
  diagnostics.push(...havingDiagnostics(ast));
  diagnostics.push(...renderDiagnostics(ast));
  return diagnostics;
}

function havingDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  if (ast.having === undefined) return [];
  const outputKeys: string[] = [];
  for (const item of ast.select) {
    try {
      outputKeys.push(parseReportSelectItem(item.value).key);
    } catch {
      return [];
    }
  }
  try {
    compileReportHaving(ast.having.value, outputKeys);
    return [];
  } catch (havingError) {
    return [
      error(
        havingError instanceof Error
          ? havingError.message
          : String(havingError),
        ast.having.span,
      ),
    ];
  }
}

// Validates the RENDER clause the same way the compiler does, but surfaces the
// failure as a positioned diagnostic instead of throwing. Skipped when GROUP BY
// is invalid (channel validation needs a known dimension).
function renderDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  if (ast.render === undefined) {
    return [];
  }
  let groupByClauses;
  try {
    groupByClauses =
      ast.groupBy === undefined ? [] : parseGroupByClauses(ast.groupBy.value);
  } catch {
    return [];
  }
  if (groupByClauses.length === 0) return [];
  const outputKeys: string[] = [];
  for (const item of ast.select) {
    try {
      outputKeys.push(parseReportSelectItem(item.value).key);
    } catch {
      // SELECT diagnostics report this at the narrower source span.
    }
  }
  try {
    parseRenderClause(
      ast.render.value,
      outputKeys,
      groupByClauses.map((clause) => clause.groupBy),
    );
    return [];
  } catch (renderError) {
    const message =
      renderError instanceof Error ? renderError.message : String(renderError);
    return [error(message, ast.render.span)];
  }
}

function sourceAndGroupDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  if (
    ast.source !== undefined &&
    !ReportSourceSchema.safeParse(ast.source.value).success
  ) {
    out.push(
      error(
        `Unknown source "${ast.source.value}". Valid sources: ${ReportSourceSchema.options.join(", ")}.`,
        ast.source.span,
      ),
    );
  }
  if (ast.groupBy !== undefined && !canParseGroupBys(ast.groupBy.value)) {
    out.push(
      error(`Unknown GROUP BY field "${ast.groupBy.value}".`, ast.groupBy.span),
    );
  }
  return out;
}

function metricDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  const groupByValue = ast.groupBy?.value;
  const groupByClauses = safeGroupBys(groupByValue);
  const labelNames = new Set([
    "label",
    ...groupByClauses.flatMap((clause) => [
      ...groupingColumnNames(clause.groupBy),
    ]),
  ]);
  let validMetrics = 0;
  for (const item of ast.select) {
    if (labelNames.has(item.value) || item.value === groupByValue) {
      continue;
    }
    try {
      parseReportSelectItem(item.value);
      validMetrics += 1;
      continue;
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : String(parseError);
      out.push(error(message, item.span));
    }
  }
  if (validMetrics === 0 && !out.some((d) => d.severity === "error")) {
    out.push(
      error("SELECT must include at least one metric.", selectSpan(ast)),
    );
  }
  return out;
}

function orderAndLimitDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  if (ast.orderBy !== undefined) {
    const { metric, direction } = ast.orderBy;
    const groupByClauses = safeGroupBys(ast.groupBy?.value);
    // The grouping column may be ordered by any of its names (`label`, `group`
    // /`pair`, or the groupBy field) — the compiler canonicalizes them to
    // `label`, so accept them here too instead of flagging a false error.
    const labelNames =
      groupByClauses.length === 0
        ? new Set(["label"])
        : new Set(
            groupByClauses.flatMap((clause) => [
              ...groupingColumnNames(clause.groupBy),
            ]),
          );
    if (
      !labelNames.has(metric.value) &&
      !ReportOrderBySchema.safeParse(metric.value).success
    ) {
      out.push(
        error(`Unknown ORDER BY target "${metric.value}".`, metric.span),
      );
    }
    if (
      direction !== undefined &&
      !ReportOrderDirectionSchema.safeParse(direction.value).success
    ) {
      out.push(
        error("ORDER BY direction must be ASC or DESC.", direction.span),
      );
    }
  }
  if (
    ast.limit !== undefined &&
    !PositiveIntSchema.safeParse(ast.limit.value).success
  ) {
    out.push(error("LIMIT must be a positive integer.", ast.limit.span));
  }
  return out;
}

function canParseGroupBys(value: string): boolean {
  try {
    const clauses = parseGroupByClauses(value);
    return clauses.length > 0 && clauses.length <= 2;
  } catch {
    return false;
  }
}

function safeGroupBys(value: string | undefined) {
  if (value === undefined) return [];
  try {
    return parseGroupByClauses(value);
  } catch {
    return [];
  }
}

function whereDiagnostics(clauses: ReportWhereClause[]): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  for (const clause of clauses) {
    if (clause.kind === "queue") {
      for (const value of clause.values) {
        if (!QueueTypeSchema.safeParse(value).success) {
          out.push(
            warning(
              `Unknown queue "${value}" — it will match no games.`,
              clause.span,
            ),
          );
        }
      }
    } else if (
      clause.kind !== "unsupported" &&
      clause.kind !== "field" &&
      !PositiveIntSchema.safeParse(clause.value).success
    ) {
      out.push(
        error(`${clause.kind} must be a positive integer.`, clause.span),
      );
    }
  }
  return out;
}

function selectSpan(ast: ReportQueryAst): ReportQuerySpan {
  const first = ast.select[0];
  const last = ast.select.at(-1);
  if (first === undefined || last === undefined) {
    return { start: 0, end: 0 };
  }
  return { start: first.span.start, end: last.span.end };
}
