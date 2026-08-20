import {
  formatReportDisplayValue,
  REPORT_METRICS,
  type ReportAiPreviewSummary,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

const MAX_NATIVE_CELL_LENGTH = 160;
const nativeCellGraphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export type NativeRowValue = string | number | null;
export type NativeRow = {
  key: string;
  label: string;
  values: Map<string, NativeRowValue>;
};

export function truncateNativeCell(
  value: string,
  maxLength = MAX_NATIVE_CELL_LENGTH,
): string {
  if (value.length <= maxLength) {
    return value;
  }
  let truncated = "";
  for (const { segment } of nativeCellGraphemeSegmenter.segment(value)) {
    if (truncated.length + segment.length > maxLength - 1) {
      break;
    }
    truncated += segment;
  }
  return `${truncated}…`;
}

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
  const series = snapshot.series.find((item) => {
    if (item.metric !== column.key) {
      return false;
    }
    const separator = item.id.lastIndexOf(":");
    const seriesDimension =
      separator === -1 ? "All" : item.id.slice(0, separator);
    if (seriesDimension === "All") {
      return item.points.some((point) => pointMatchesRow(point, row, null));
    }
    if (!row.key.startsWith(`${seriesDimension} • `)) {
      return false;
    }
    const pointDimension = row.key.slice(seriesDimension.length + 3);
    return item.points.some((point) =>
      pointMatchesRow(point, row, pointDimension),
    );
  });
  if (series === undefined) {
    return value;
  }
  const separator = series.id.lastIndexOf(":");
  const seriesDimension =
    separator === -1 ? "All" : series.id.slice(0, separator);
  const pointDimension =
    seriesDimension === "All"
      ? null
      : row.key.slice(seriesDimension.length + 3);
  const point = series.points.find((candidate) =>
    pointMatchesRow(candidate, row, pointDimension),
  );
  return `${value}${formatConfidenceInterval(snapshot, series, point)}`;
}

function pointMatchesRow(
  point: TemporalSeries["points"][number],
  row: NativeRow,
  pointDimension: string | null,
): boolean {
  if (point.key === row.key || point.label === row.label) {
    return true;
  }
  const dimension = pointDimension ?? row.key;
  return (
    displayDimensionMatches(dimension, point.key) ||
    displayDimensionMatches(dimension, point.label)
  );
}

function displayDimensionMatches(value: string, dimension: string): boolean {
  return (
    value === dimension ||
    value.startsWith(`${dimension} • `) ||
    value.endsWith(` • ${dimension}`) ||
    value.includes(` • ${dimension} • `)
  );
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
