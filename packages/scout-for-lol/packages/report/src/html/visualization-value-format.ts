import {
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

const VALUE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

/**
 * Legacy metric names that were rates, for snapshots stored before ScoutQL v2.
 *
 * Frozen on purpose: it describes history, not a living vocabulary. Under v1 a
 * series' `metric` was a member of a closed enum whose registry knew its kind;
 * v2 snapshots carry `displayKind` instead, so this only ever answers for rows
 * already on disk. Do not add to it — a new rate arrives with its display kind
 * attached.
 */
const LEGACY_RATE_METRICS: ReadonlySet<string> = new Set([
  "win_rate",
  "surrender_rate",
  "early_surrender_rate",
  "first_blood_rate",
  "top_two_rate",
  "first_place_rate",
]);

export function formatSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  if (isPercentageSeries(snapshot, series)) {
    return formatPercent(value);
  }
  if (series.displayKind === "duration") {
    return formatDuration(value);
  }
  return formatValue(value);
}

function padTimePart(part: number): string {
  return part.toString().padStart(2, "0");
}

/** Seconds as m:ss (or h:mm:ss) — a game length reads as 28:29, not 1709. */
export function formatDuration(value: number | null): string {
  if (value === null) return "Unknown";
  const total = Math.max(0, Math.round(value));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours.toString()}:${padTimePart(minutes)}:${padTimePart(seconds)}`
    : `${minutes.toString()}:${padTimePart(seconds)}`;
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

export function formatSnapshotAxisValue(
  snapshot: VisualizationSnapshot,
  value: number,
): string {
  return usesPercentageAxis(snapshot)
    ? formatPercent(value)
    : formatValue(value);
}

export function isPercentageSeries(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
): boolean {
  if (snapshot.display.stack === "percent") return true;
  // v2 snapshots say what they are; pre-v2 ones are answered from the frozen
  // legacy table above.
  if (series.displayKind !== undefined) {
    return series.displayKind === "percent";
  }
  return LEGACY_RATE_METRICS.has(series.metric);
}

export function formatValue(value: number | null): string {
  return value === null ? "Unknown" : VALUE_FORMATTER.format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}
