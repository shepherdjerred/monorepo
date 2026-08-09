import type { VisualizationSnapshot } from "@scout-for-lol/data";
import { format as echartsFormat } from "echarts";

export function calendarTooltipText(
  snapshot: VisualizationSnapshot,
  input: unknown,
): string {
  if (typeof input !== "object" || input === null || !("data" in input)) {
    return "";
  }
  const data = input.data;
  if (!Array.isArray(data)) return "";
  const label = echartsFormat.encodeHTML(String(data[0]));
  const value = typeof data[1] === "number" ? data[1] : null;
  const sampleSize = typeof data[5] === "number" ? data[5] : 0;
  const lines = [
    `${label}: ${formatValue(value)} (n=${sampleSize.toString()})`,
  ];
  if (snapshot.temporal?.comparison !== undefined) {
    const comparison = typeof data[2] === "number" ? data[2] : null;
    const absolute = typeof data[3] === "number" ? data[3] : null;
    const percentage = typeof data[4] === "number" ? data[4] : null;
    lines.push(
      `Baseline: ${formatValue(comparison)} · Δ ${formatValue(absolute)} · ${formatPercent(percentage)}`,
    );
  }
  return lines.join("<br/>");
}

function formatValue(value: number | null): string {
  return value === null
    ? "Unknown"
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}
