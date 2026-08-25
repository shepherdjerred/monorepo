import {
  REPORT_AI_PREVIEW_MAX_ROWS,
  REPORT_VISUALIZATION_PREVIEW_MAX_ROWS,
  reportResultColumns,
  ReportAiPreviewSummarySchema,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-types.ts";

function previewRow(
  row: ReportQueryResult["rows"][number],
  evidence: ReportQueryResult["evidence"],
  index: number,
) {
  const games = evidence?.[index]?.games;

  return {
    label: row.label,
    ...(games === undefined ? {} : { games }),
    values: row.values.map((value) => ({
      column: value.column,
      value: value.value,
    })),
  };
}

export function reportQueryPreviewSummary(
  result: ReportQueryResult,
): ReportAiPreviewSummary {
  return ReportAiPreviewSummarySchema.parse({
    columns: reportResultColumns(result.plan, result.columns),
    rows: result.rows
      .slice(0, REPORT_AI_PREVIEW_MAX_ROWS)
      .map((row, index) => previewRow(row, result.evidence, index)),
    visualizationRows: result.rows
      .slice(0, REPORT_VISUALIZATION_PREVIEW_MAX_ROWS)
      .map((row, index) => previewRow(row, result.evidence, index)),
    rowsReturned: result.rows.length,
    rowsScanned: result.rowsScanned,
    renderKind: result.plan.render.kind,
  });
}
