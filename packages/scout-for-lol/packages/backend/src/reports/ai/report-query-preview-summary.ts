import {
  REPORT_AI_PREVIEW_MAX_ROWS,
  REPORT_VISUALIZATION_PREVIEW_MAX_ROWS,
  reportResultColumns,
  ReportAiPreviewSummarySchema,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-types.ts";

export function reportQueryPreviewSummary(
  result: ReportQueryResult,
): ReportAiPreviewSummary {
  return ReportAiPreviewSummarySchema.parse({
    columns: reportResultColumns(result.plan, result.columns),
    rows: result.rows.slice(0, REPORT_AI_PREVIEW_MAX_ROWS).map((row) => ({
      label: row.label,
      values: row.values.map((value) => ({
        column: value.column,
        value: value.value,
      })),
    })),
    visualizationRows: result.rows
      .slice(0, REPORT_VISUALIZATION_PREVIEW_MAX_ROWS)
      .map((row) => ({
        label: row.label,
        values: row.values.map((value) => ({
          column: value.column,
          value: value.value,
        })),
      })),
    rowsReturned: result.rows.length,
    rowsScanned: result.rowsScanned,
    renderKind: result.plan.render.kind,
  });
}
