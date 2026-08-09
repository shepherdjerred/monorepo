import type {
  TemporalSeriesPoint,
  VisualizationSnapshot,
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
  const point = renderedScatterPoints(series)[dataIndex];
  return point === undefined ? "" : pointTooltipText(snapshot, point, [series]);
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
    lines.push(
      `${echartsFormat.encodeHTML(series.label)}: ${formatSeriesValue(snapshot, series, value.value)} (n=${value.evidence.sampleSize.toString()})`,
    );
    if (snapshot.temporal?.comparison !== undefined) {
      lines.push(
        `Baseline: ${formatSeriesValue(snapshot, series, value.comparisonValue ?? null)} · Δ ${formatSeriesAbsoluteDelta(snapshot, series, value.absoluteDelta ?? null)} · ${formatPercent(value.percentageDelta ?? null)}`,
      );
    }
    if (value.evidence.confidenceInterval !== null) {
      lines.push(
        `95% CI ${formatPercent(value.evidence.confidenceInterval.lower)}–${formatPercent(value.evidence.confidenceInterval.upper)}`,
      );
    }
  }
  return lines.join("<br/>");
}
