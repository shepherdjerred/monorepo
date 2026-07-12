import { z } from "zod";
import {
  ReportMetricSchema,
  ReportOrderBySchema,
  ReportOrderDirectionSchema,
  ReportSourceSchema,
  type ReportDiagnostic,
  type ReportMetric,
  type ReportQueryAst,
  type ReportQuerySpan,
} from "#src/model/report-query-spec.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";
import {
  groupingColumnNames,
  parseGroupByClause,
  parseRenderClause,
} from "#src/model/report-query-compile.ts";
import { tokenizeReportQuery } from "#src/model/report-query-lexer.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import {
  closestChampionName,
  resolveReportChampion,
} from "#src/model/report-query-champions.ts";

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
  diagnostics.push(...whereDiagnostics(ast));
  diagnostics.push(...renderDiagnostics(ast));
  return diagnostics;
}

// Validates the RENDER clause the same way the compiler does, but surfaces the
// failure as a positioned diagnostic instead of throwing. Skipped when GROUP BY
// is invalid (channel validation needs a known dimension).
function renderDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  if (ast.render === undefined) {
    return [];
  }
  const groupByClause =
    ast.groupBy === undefined
      ? undefined
      : parseGroupByClause(ast.groupBy.value);
  if (groupByClause === undefined) {
    return [];
  }
  const metrics: ReportMetric[] = [];
  for (const item of ast.select) {
    const parsed = ReportMetricSchema.safeParse(item.value);
    if (parsed.success) {
      metrics.push(parsed.data);
    }
  }
  try {
    parseRenderClause(ast.render.value, metrics, groupByClause.groupBy);
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
  if (
    ast.groupBy !== undefined &&
    parseGroupByClause(ast.groupBy.value) === undefined
  ) {
    out.push(
      error(
        `Unknown GROUP BY field "${ast.groupBy.value}". Valid fields: player, champion, queue, group(2..5), group(all), pair.`,
        ast.groupBy.span,
      ),
    );
  }
  return out;
}

function metricDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  const groupByValue = ast.groupBy?.value;
  const groupByClause =
    groupByValue === undefined ? undefined : parseGroupByClause(groupByValue);
  const labelNames =
    groupByClause === undefined
      ? new Set(["label"])
      : groupingColumnNames(groupByClause.groupBy);
  let validMetrics = 0;
  for (const item of ast.select) {
    if (labelNames.has(item.value) || item.value === groupByValue) {
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
    const groupByClause =
      ast.groupBy === undefined
        ? undefined
        : parseGroupByClause(ast.groupBy.value);
    // The grouping column may be ordered by any of its names (`label`, `group`
    // /`pair`, or the groupBy field) — the compiler canonicalizes them to
    // `label`, so accept them here too instead of flagging a false error.
    const labelNames =
      groupByClause === undefined
        ? new Set(["label"])
        : groupingColumnNames(groupByClause.groupBy);
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

function whereDiagnostics(ast: ReportQueryAst): ReportDiagnostic[] {
  const out: ReportDiagnostic[] = [];
  for (const clause of ast.where) {
    switch (clause.kind) {
      case "queue": {
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
        break;
      }
      case "champion": {
        if (resolveReportChampion(clause.name) === undefined) {
          const suggestion = closestChampionName(clause.name);
          out.push(
            error(
              suggestion === undefined
                ? `Unknown champion "${clause.name}".`
                : `Unknown champion "${clause.name}". Did you mean "${suggestion}"?`,
              clause.span,
            ),
          );
        }
        break;
      }
      case "lookback": {
        const expected =
          ast.source?.value === "prematch_participants"
            ? "observed_at"
            : "game_creation_at";
        if (clause.field !== expected) {
          out.push(
            error(
              `Source "${ast.source?.value ?? "unknown"}" uses ${expected} for lookback filters.`,
              clause.span,
            ),
          );
        }
        break;
      }
      case "champion_id":
      case "min_games":
      case "competition_id": {
        if (!PositiveIntSchema.safeParse(clause.value).success) {
          out.push(
            error(`${clause.kind} must be a positive integer.`, clause.span),
          );
        }
        break;
      }
      case "unsupported": {
        break;
      }
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
