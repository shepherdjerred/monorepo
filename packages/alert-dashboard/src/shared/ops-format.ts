import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Metric } from "@shepherdjerred/ops-model/snapshot.ts";

import type { SeriesUnit, Trend } from "#shared/ops-schema";

export type ValueUnit = Metric["unit"] | SeriesUnit | Trend["unit"];

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Human value for tiles, digests, and axis ticks. `null` is "no data". */
export function formatValue(value: number | null, unit: ValueUnit): string {
  if (value === null) return "—";
  switch (unit) {
    case "usd":
      return usd.format(value);
    case "ratio":
      return `${String(Math.round(value * 100))}%`;
    case "percent":
      return `${String(Math.round(value))}%`;
    case "seconds":
      return formatDurationSeconds(value);
    case "hours":
      return `${value.toFixed(1)} h`;
    case "tokens":
      return compact.format(value);
    case "count":
      return Number.isInteger(value) ? compact.format(value) : value.toFixed(1);
  }
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))}s`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m`;
  return seconds < 86_400
    ? `${(seconds / 3600).toFixed(1)}h`
    : `${(seconds / 86_400).toFixed(1)}d`;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "OK",
  info: "Info",
  unknown: "Unknown",
  warning: "Warning",
  error: "Error",
};

/** Signed change between two readings, or `null` when either is missing. */
export function trendDelta(trend: Trend): number | null {
  return trend.current === null || trend.previous === null
    ? null
    : trend.current - trend.previous;
}

export function formatDelta(delta: number | null, unit: ValueUnit): string {
  if (delta === null) return "no comparison";
  if (delta === 0) return "no change";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatValue(Math.abs(delta), unit)}`;
}
