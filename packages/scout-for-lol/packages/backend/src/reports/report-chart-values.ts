import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import { columnLabel, planDisplayKind } from "#src/reports/plan-columns.ts";
import type { ReportResultRow } from "#src/reports/query-engine.ts";

/**
 * Chart-side reading of result values. How a column reads is the plan's
 * business — `plan.outputs[i].displayKind` — so a percentage is scaled to
 * 0-100 for the axis and suffixed, and everything else is left alone.
 */

export type MetricDisplay = { label: string; percent: boolean };

export function columnDisplay(
  plan: ScoutQlPlan,
  column: string,
): MetricDisplay {
  return {
    label: columnLabel(column),
    percent: planDisplayKind(plan, column) === "percent",
  };
}

export function chartSeries(
  plan: ScoutQlPlan,
  rows: ReportResultRow[],
  columns: string[],
) {
  return columns.map((column) => ({
    name: columnDisplay(plan, column).label,
    values: rows.map((row) => nullableChartNumber(plan, row, column)),
  }));
}

export function nullableChartNumber(
  plan: ScoutQlPlan,
  row: ReportResultRow,
  column: string,
): number | null {
  const value = row.values.find((entry) => entry.column === column)?.value;
  if (value === null || value === undefined) return null;
  if (typeof value !== "number") {
    throw new TypeError(`Chart column ${column} is not numeric.`);
  }
  return columnDisplay(plan, column).percent ? value * 100 : value;
}

export function chartNumber(
  plan: ScoutQlPlan,
  row: ReportResultRow,
  column: string,
): number {
  return nullableChartNumber(plan, row, column) ?? 0;
}

export function formattedChartValue(
  plan: ScoutQlPlan,
  row: ReportResultRow,
  column: string,
): string {
  const value = nullableChartNumber(plan, row, column);
  if (value === null) return "—";
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toFixed(2);
  return `${formatted}${columnDisplay(plan, column).percent ? "%" : ""}`;
}

export function uniqueDimensions(
  rows: ReportResultRow[],
  index: number,
): string[] {
  return [...new Set(rows.map((row) => row.dimensions[index] ?? ""))];
}
