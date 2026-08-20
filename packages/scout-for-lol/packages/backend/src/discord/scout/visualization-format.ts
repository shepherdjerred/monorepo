import {
  formatReportDisplayValue,
  REPORT_METRICS,
  type ReportAiPreviewSummary,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

export type NativeRowValue = string | number | null;
export type NativeRow = {
  key: string;
  label: string;
  values: Map<string, NativeRowValue>;
};

export function formatPreviewValue(
  column: ReportAiPreviewSummary["columns"][number],
  value: NativeRowValue,
): string {
  return value === null ? "Unknown" : formatReportDisplayValue(column, value);
}

export function formatPreviewValueWithEvidence(
  snapshot: VisualizationSnapshot,
  column: ReportAiPreviewSummary["columns"][number],
  row: NativeRow,
): string {
  const value = formatPreviewValue(column, requireRowValue(row, column.key));
  const series = snapshot.series.find((item) => item.id === column.key);
  if (series === undefined) {
    return value;
  }
  const rowDimensions = new Set(row.key.split(" • "));
  const point = series.points.find(
    (item) =>
      item.key === row.key ||
      item.label === row.label ||
      rowDimensions.has(item.key) ||
      rowDimensions.has(item.label),
  );
  return `${value}${formatConfidenceInterval(snapshot, series, point)}`;
}

export function requireRowValue(
  row: NativeRow,
  column: string,
): NativeRowValue {
  const value = row.values.get(column);
  if (value === undefined) {
    throw new Error(`Visualization row missing value for ${column}.`);
  }
  return value;
}

export function formatNativeSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  row: NativeRow,
): string {
  const value = formatSeriesValue(
    snapshot,
    series,
    requireNumericRowValue(row, series.id),
  );
  const point = series.points.find((item) => item.key === row.key);
  const confidenceIntervalText = formatConfidenceInterval(
    snapshot,
    series,
    point,
  );
  if (
    point === undefined ||
    (snapshot.temporal?.comparison === undefined &&
      point.comparisonEvidence === undefined)
  ) {
    return `${value}${confidenceIntervalText}`;
  }
  const percentage = point.percentageDelta;
  return `${value}${confidenceIntervalText} · Baseline: ${formatSeriesValue(
    snapshot,
    series,
    point.comparisonValue ?? null,
  )} · Δ ${formatAbsoluteDelta(snapshot, series, point.absoluteDelta ?? null)} · ${
    percentage === null || percentage === undefined
      ? "Unknown"
      : `${(percentage * 100).toFixed(1)}%`
  }`;
}

function formatConfidenceInterval(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  point: TemporalSeries["points"][number] | undefined,
): string {
  const confidenceInterval = point?.evidence.confidenceInterval;
  return confidenceInterval === null || confidenceInterval === undefined
    ? ""
    : ` · 95% CI ${formatSeriesValue(
        snapshot,
        series,
        confidenceInterval.lower,
      )}–${formatSeriesValue(snapshot, series, confidenceInterval.upper)}`;
}

export function formatSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  if (value === null) {
    return "Unknown";
  }
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  if (isRate) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    value,
  );
}

export function formatAbsoluteDelta(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  return isRate
    ? value === null
      ? "Unknown"
      : `${(value * 100).toFixed(1)} pp`
    : formatSeriesValue(snapshot, series, value);
}

export function requireNumericRowValue(
  row: NativeRow,
  column: string,
): number | null {
  const value = row.values.get(column) ?? null;
  if (typeof value !== "number" && value !== null) {
    throw new Error(`Visualization row value for ${column} is not numeric.`);
  }
  return value;
}
