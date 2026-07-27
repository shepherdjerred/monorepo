import { REPORT_METRICS } from "@scout-for-lol/data";
import type { ReportResultRow } from "#src/reports/query-engine.ts";

export type MetricDisplay = { label: string; percent: boolean };

export function columnDisplay(column: string): MetricDisplay {
  const metric = REPORT_METRICS.find((entry) => entry.id === column);
  if (metric !== undefined) {
    return { label: metric.label, percent: metric.kind === "rate" };
  }
  return {
    label: column
      .split("_")
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join(" "),
    percent: column.endsWith("_rate") || column.endsWith("_percent"),
  };
}

export function chartSeries(rows: ReportResultRow[], columns: string[]) {
  return columns.map((column) => ({
    name: columnDisplay(column).label,
    values: rows.map((row) => nullableChartNumber(row, column)),
  }));
}

export function nullableChartNumber(
  row: ReportResultRow,
  column: string,
): number | null {
  const value = row.values.find((entry) => entry.column === column)?.value;
  if (value === null || value === undefined) return null;
  if (typeof value !== "number")
    throw new Error(`Chart column ${column} is not numeric.`);
  return columnDisplay(column).percent ? value * 100 : value;
}

export function chartNumber(row: ReportResultRow, column: string): number {
  return nullableChartNumber(row, column) ?? 0;
}

export function formattedChartValue(
  row: ReportResultRow,
  column: string,
): string {
  const value = nullableChartNumber(row, column);
  if (value === null) return "—";
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toFixed(2);
  return `${formatted}${columnDisplay(column).percent ? "%" : ""}`;
}

export function uniqueDimensions(
  rows: ReportResultRow[],
  index: number,
): string[] {
  return [...new Set(rows.map((row) => row.dimensions[index] ?? ""))];
}
