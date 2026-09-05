import type { VisualizationSnapshot } from "@scout-for-lol/data";
import type * as echarts from "echarts";
import {
  VISUALIZATION_BODY_FONT,
  visualizationSnapshotAxis,
  visualizationSnapshotBaseOption,
  visualizationSnapshotLabels,
  visualizationSnapshotLegend,
  visualizationSnapshotPresentation,
  type VisualizationRenderMode,
} from "#src/html/visualization-snapshot-style.ts";

export function donutOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationRenderMode = "static",
): echarts.EChartsOption {
  const presentation = visualizationSnapshotPresentation(snapshot);
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout analysis", mode),
    tooltip: { trigger: "item" },
    legend: visualizationSnapshotLegend(presentation, "right", mode),
    series: [
      {
        type: "pie",
        radius: ["42%", "70%"],
        center: ["42%", "55%"],
        data: snapshot.series.flatMap((series) =>
          series.points.flatMap((point) =>
            point.value === null
              ? []
              : [
                  {
                    name: donutPointLabel(
                      series.label,
                      series.metric,
                      point.label,
                    ),
                    value: point.value,
                  },
                ],
          ),
        ),
        label: {
          ...visualizationSnapshotLabels(presentation.options, false, {
            defaultShow: true,
            mode,
          }),
          color: presentation.theme.text,
          ...(mode === "interactive"
            ? { fontFamily: VISUALIZATION_BODY_FONT }
            : {}),
          ...(presentation.options.labels === "percent"
            ? { formatter: "{b}: {d}%" }
            : {}),
        },
      },
    ],
  };
}

export function heatmapOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationRenderMode = "static",
): echarts.EChartsOption {
  const xCategories = snapshot.series.map((series) => series.label);
  const yCategories = [
    ...new Set(
      snapshot.series.flatMap((series) =>
        series.points.map((point) => point.label),
      ),
    ),
  ];
  const cells = snapshot.series.flatMap((series, x) =>
    series.points.flatMap((point) =>
      point.value === null
        ? []
        : [[x, yCategories.indexOf(point.label), point.value]],
    ),
  );
  const values = cells.map((cell) => cell[2] ?? 0);
  const presentation = visualizationSnapshotPresentation(snapshot);
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout analysis", mode),
    tooltip: { position: "top" },
    grid: { left: 90, right: 48, top: 90, bottom: 86 },
    xAxis: {
      type: "category",
      data: xCategories,
      splitArea: { show: true },
      ...visualizationSnapshotAxis(
        presentation.theme,
        presentation.options.xAxisLabel,
        mode,
      ),
    },
    yAxis: {
      type: "category",
      data: yCategories,
      splitArea: { show: true },
      ...visualizationSnapshotAxis(
        presentation.theme,
        presentation.options.yAxisLabel,
        mode,
      ),
    },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 18,
      textStyle: {
        color: presentation.theme.muted,
        ...(mode === "interactive"
          ? { fontFamily: VISUALIZATION_BODY_FONT }
          : {}),
      },
      inRange: { color: presentation.colors },
    },
    series: [
      {
        type: "heatmap",
        data: cells,
        label: visualizationSnapshotLabels(presentation.options, false, {
          defaultShow: true,
          mode,
        }),
      },
    ],
  };
}

export function radarOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationRenderMode = "static",
): echarts.EChartsOption {
  const entities = [
    ...new Set(
      snapshot.series.flatMap((series) =>
        series.points.map((point) => point.label),
      ),
    ),
  ];
  const maxima = snapshot.series.map((series) =>
    Math.max(1, ...series.points.map((point) => point.value ?? 0)),
  );
  const presentation = visualizationSnapshotPresentation(snapshot);
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout analysis", mode),
    tooltip: {},
    legend: visualizationSnapshotLegend(presentation, "top", mode),
    radar: {
      center: ["50%", "57%"],
      radius: "62%",
      indicator: snapshot.series.map((series, index) => ({
        name: series.metric,
        max: maxima[index] ?? 1,
      })),
      axisName: {
        color: presentation.theme.text,
        ...(mode === "interactive"
          ? { fontFamily: VISUALIZATION_BODY_FONT }
          : {}),
      },
      splitLine: { lineStyle: { color: presentation.theme.border } },
    },
    series: [
      {
        type: "radar",
        data: entities.map((entity) => ({
          name: entity,
          value: snapshot.series.map(
            (series) =>
              series.points.find((point) => point.label === entity)?.value ?? 0,
          ),
        })),
      },
    ],
  };
}

function donutPointLabel(
  seriesLabel: string,
  metric: string,
  pointLabel: string,
): string {
  if (seriesLabel === metric) return pointLabel;
  const metricSuffix = ` — ${metric}`;
  const groupLabel = seriesLabel.endsWith(metricSuffix)
    ? seriesLabel.slice(0, -metricSuffix.length)
    : seriesLabel;
  return `${groupLabel} • ${pointLabel}`;
}
