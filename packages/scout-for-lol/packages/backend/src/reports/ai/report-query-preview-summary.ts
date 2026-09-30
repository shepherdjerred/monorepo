import {
  EXPLORE_MODEL_PREVIEW_MAX_ROWS,
  REPORT_AI_PREVIEW_MAX_ROWS,
  REPORT_VISUALIZATION_PREVIEW_MAX_ROWS,
  ReportAiModelPreviewSummarySchema,
  ReportAiPreviewSummarySchema,
  type ReportAiModelPreviewSummary,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import { planResultColumns } from "#src/reports/query/plan-columns.ts";
import type { ReportQueryResult } from "#src/reports/query/query-types.ts";

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
    columns: planResultColumns(result.plan, result.columns),
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

/**
 * Model-facing preview for Explore, which has a larger row budget than saved
 * report editing. Persisted and user-visible report previews stay capped at
 * REPORT_AI_PREVIEW_MAX_ROWS.
 */
export function reportQueryModelPreviewSummary(
  result: ReportQueryResult,
): ReportAiModelPreviewSummary {
  return ReportAiModelPreviewSummarySchema.parse({
    columns: planResultColumns(result.plan, result.columns),
    rows: result.rows
      .slice(0, EXPLORE_MODEL_PREVIEW_MAX_ROWS)
      .map((row, index) => previewRow(row, result.evidence, index)),
    rowsReturned: result.rows.length,
    rowsScanned: result.rowsScanned,
    renderKind: result.plan.render.kind,
  });
}
