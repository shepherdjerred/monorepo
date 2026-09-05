import type { ReportResultColumn } from "#src/model/reports/report-ai.ts";

/**
 * The header a grand-total result's dimension column carries.
 *
 * A ScoutQL v2 plan with no groupings still emits the hidden `label` column,
 * and nothing dimensional went into it. The engine names that column from
 * here, and the web app recognises an ungrouped result by comparing against
 * the same constant rather than a literal, so the two cannot drift.
 */
export const UNGROUPED_LABEL_COLUMN_LABEL = "Label";

export function formatReportDisplayValue(
  column: ReportResultColumn,
  value: string | number,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (column.format === "percent") {
    return `${(value * 100).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  }
  if (column.format === "integer") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
