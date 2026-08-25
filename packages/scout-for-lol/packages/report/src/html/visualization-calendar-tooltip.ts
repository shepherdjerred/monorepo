import {
  REPORT_METRICS,
  evidenceGames,
  isLowSampleGameCount,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { format as echartsFormat } from "echarts";
import {
  formatPercent,
  formatSeriesAbsoluteDelta,
  formatSeriesValue,
  formatValue,
} from "#src/html/visualization-value-format.ts";

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
  const series = snapshot.series[0];
  const formattedValue =
    series === undefined
      ? formatValue(value)
      : formatSeriesValue(snapshot, series, value);
  const gameBasis = calendarGameBasis(series, sampleSize);
  const lines = [`${label}: ${formattedValue}${gameBasis}`];
  if (
    series !== undefined &&
    (snapshot.display.stack === "percent" ||
      REPORT_METRICS.some(
        (candidate) =>
          candidate.id === series.metric && candidate.kind === "rate",
      )) &&
    isLowSampleGameCount(evidenceGames({ games: sampleSize, sampleSize }))
  ) {
    lines.push("Fewer than 10 games — treat this rate as indicative only.");
  }
  if (snapshot.temporal?.comparison !== undefined) {
    const comparison = typeof data[2] === "number" ? data[2] : null;
    const absolute = typeof data[3] === "number" ? data[3] : null;
    const percentage = typeof data[4] === "number" ? data[4] : null;
    const formattedComparison =
      series === undefined
        ? formatValue(comparison)
        : formatSeriesValue(snapshot, series, comparison);
    const formattedAbsolute =
      series === undefined
        ? formatValue(absolute)
        : formatSeriesAbsoluteDelta(snapshot, series, absolute);
    lines.push(
      `Baseline: ${formattedComparison} · Δ ${formattedAbsolute} · ${formatPercent(percentage)}`,
    );
  }
  return lines.join("<br/>");
}

function calendarGameBasis(
  series: VisualizationSnapshot["series"][number] | undefined,
  sampleSize: number,
): string {
  return series?.metric === "rank_position"
    ? ""
    : ` (Based on ${sampleSize.toString()} games)`;
}
