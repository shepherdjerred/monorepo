import { z } from "zod";
import {
  ReportGroupBySchema,
  ReportMetricSchema,
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportSourceSchema,
  type ReportDiagnostic,
  type ReportQueryAst,
  type ReportQuerySpan,
  type ReportWhereClause,
} from "#src/model/report-query-spec.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
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
  return diagnostics;
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
  if (
    ast.groupBy !== undefined &&
    !ReportGroupBySchema.safeParse(ast.groupBy.value).success
  ) {
    out.push(
      error(
        `Unknown GROUP BY field "${ast.groupBy.value}". Valid fields: ${ReportGroupBySchema.options.join(", ")}.`,
        ast.groupBy.span,
      ),
    );
  }
  return out;
}

function metricDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  const groupByValue = ast.groupBy?.value;
  let validMetrics = 0;
  for (const item of ast.select) {
    if (item.value === "label" || item.value === groupByValue) {
      continue;
    }
    if (ReportMetricSchema.safeParse(item.value).success) {
      validMetrics += 1;
      continue;
    }
    out.push(error(`Unknown metric "${item.value}".`, item.span));
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
    if (!ReportOrderBySchema.safeParse(metric.value).success) {
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
