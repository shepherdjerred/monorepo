import type {
  TemporalSeriesPoint,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  REPORT_METRICS,
  evidenceGames,
  isLowSampleGameCount,
} from "@scout-for-lol/data";
import { format as echartsFormat } from "echarts";
import {
  formatPercent,
  formatSeriesAbsoluteDelta,
  formatSeriesValue,
} from "#src/html/visualization-value-format.ts";

export function scatterTooltipText(
  snapshot: VisualizationSnapshot,
  input: object,
  dataIndex: number,
): string {
  const seriesId =
    "seriesId" in input && typeof input.seriesId === "string"
      ? input.seriesId
      : undefined;
  const seriesName =
    "seriesName" in input && typeof input.seriesName === "string"
      ? input.seriesName
      : undefined;
  const series = snapshot.series.find(
    (candidate) =>
      (seriesId !== undefined && candidate.id === seriesId) ||
      (seriesId === undefined &&
        seriesName !== undefined &&
        candidate.label === seriesName),
  );
  if (series === undefined) return "";
  const pointKey = scatterPointKey(input);
  const point =
    (pointKey === undefined
      ? undefined
      : series.points.find((candidate) => candidate.key === pointKey)) ??
    renderedScatterPoints(series)[dataIndex];
  return point === undefined ? "" : pointTooltipText(snapshot, point, [series]);
}

function scatterPointKey(input: object): string | undefined {
  if (
    !("data" in input) ||
    typeof input.data !== "object" ||
    input.data === null
  ) {
    return undefined;
  }
  return "id" in input.data && typeof input.data.id === "string"
    ? input.data.id
    : undefined;
}

function renderedScatterPoints(
  series: VisualizationSnapshot["series"][number],
): TemporalSeriesPoint[] {
  return series.points.filter(
    (point) => point.xValue !== undefined && point.xValue !== null,
  );
}

export function pointTooltipText(
  snapshot: VisualizationSnapshot,
  point: TemporalSeriesPoint,
  seriesItems: VisualizationSnapshot["series"],
): string {
  const lines = [`<strong>${echartsFormat.encodeHTML(point.label)}</strong>`];
  for (const series of seriesItems) {
    const value = series.points.find(
      (candidate) => candidate.label === point.label,
    );
    if (value === undefined) continue;
    const games = evidenceGames(value.evidence);
    lines.push(
      `${echartsFormat.encodeHTML(series.label)}: ${formatSeriesValue(snapshot, series, value.value)} (Based on ${games.toString()} games)`,
    );
    if (snapshot.temporal?.comparison !== undefined) {
      lines.push(
        `Baseline: ${formatSeriesValue(snapshot, series, value.comparisonValue ?? null)} · Δ ${formatSeriesAbsoluteDelta(snapshot, series, value.absoluteDelta ?? null)} · ${formatPercent(value.percentageDelta ?? null)}`,
      );
    }
    if (
      (snapshot.display.stack === "percent" || isRateMetric(series.metric)) &&
      isLowSampleGameCount(games)
    ) {
      lines.push("Fewer than 10 games — treat this rate as indicative only.");
    }
  }
  return lines.join("<br/>");
}

function isRateMetric(metric: string): boolean {
  return REPORT_METRICS.some(
    (candidate) => candidate.id === metric && candidate.kind === "rate",
  );
}
