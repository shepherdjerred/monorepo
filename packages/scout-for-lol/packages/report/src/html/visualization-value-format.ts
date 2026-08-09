import {
  REPORT_METRICS,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

export function formatSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  return isPercentageSeries(snapshot, series)
    ? formatPercent(value)
    : formatValue(value);
}

export function formatSeriesAbsoluteDelta(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  if (!isPercentageSeries(snapshot, series)) return formatValue(value);
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)} pp`;
}

export function usesPercentageAxis(snapshot: VisualizationSnapshot): boolean {
  return (
    snapshot.series.length > 0 &&
    snapshot.series.every((series) => isPercentageSeries(snapshot, series))
  );
}

export function isPercentageSeries(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
): boolean {
  if (snapshot.display.stack === "percent") return true;
  return (
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
    "rate"
  );
}

export function formatValue(value: number | null): string {
  return value === null
    ? "Unknown"
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}
