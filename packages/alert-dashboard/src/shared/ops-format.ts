import type { Severity } from "@shepherdjerred/ops-model/severity.ts";

import type { SeriesUnitSchema, Trend } from "#shared/ops-schema";

export type ValueUnit = (typeof SeriesUnitSchema.options)[number];

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
const BPS_UNITS = ["B/s", "KiB/s", "MiB/s", "GiB/s"] as const;

function formatIec(
  value: number,
  units: readonly [string, ...string[]],
): string {
  let scaled = value;
  let index = 0;
  while (
    index < units.length - 1 &&
    (index === 0
      ? Math.round(Math.abs(scaled)) >= 1024
      : Math.abs(scaled) >= 1024)
  ) {
    scaled /= 1024;
    index += 1;
  }
  const suffix = units[index] ?? units[0];
  return index === 0
    ? `${String(Math.round(scaled))} ${suffix}`
    : `${scaled.toFixed(1)} ${suffix}`;
}

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
    case "bytes":
      return formatIec(value, BYTE_UNITS);
    case "bps":
      return formatIec(value, BPS_UNITS);
    case "ms":
      return Math.round(Math.abs(value)) < 1000
        ? `${String(Math.round(value))} ms`
        : `${(value / 1000).toFixed(1)}s`;
    case "celsius":
      return `${String(Math.round(value))}°C`;
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
