import type { VisualizationSnapshot } from "@scout-for-lol/data";
import type * as echarts from "echarts";

export function donutOption(
  snapshot: VisualizationSnapshot,
): echarts.EChartsOption {
  const series = snapshot.series[0];
  return {
    ...baseOption(snapshot),
    tooltip: { trigger: "item" },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 24,
      top: 72,
      textStyle: { color: "#a09b8c" },
    },
    series: [
      {
        type: "pie",
        radius: ["42%", "70%"],
        center: ["42%", "55%"],
        data:
          series?.points.flatMap((point) =>
            point.value === null
              ? []
              : [{ name: point.label, value: point.value }],
          ) ?? [],
        label: { color: "#f0e6d2" },
      },
    ],
  };
}

export function heatmapOption(
  snapshot: VisualizationSnapshot,
  interactive: boolean,
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
  return {
    ...baseOption(snapshot),
    tooltip: { position: "top" },
    grid: { left: 90, right: 48, top: 90, bottom: 86 },
    xAxis: {
      type: "category",
      data: xCategories,
      splitArea: { show: true },
      axisLabel: { color: "#a09b8c" },
    },
    yAxis: {
      type: "category",
      data: yCategories,
      splitArea: { show: true },
      axisLabel: { color: "#a09b8c" },
    },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      calculable: interactive,
      orient: "horizontal",
      left: "center",
      bottom: 18,
      textStyle: { color: "#a09b8c" },
      inRange: { color: ["#1e282d", "#0ac8b9", "#c8aa6e"] },
    },
    series: [{ type: "heatmap", data: cells, label: { show: true } }],
  };
}

export function radarOption(
  snapshot: VisualizationSnapshot,
): echarts.EChartsOption {
  const categories = [
    ...new Set(
      snapshot.series.flatMap((series) =>
        series.points.map((point) => point.label),
      ),
    ),
  ];
  const maxima = categories.map((category) =>
    Math.max(
      1,
      ...snapshot.series.map(
        (series) =>
          series.points.find((point) => point.label === category)?.value ?? 0,
      ),
    ),
  );
  return {
    ...baseOption(snapshot),
    tooltip: {},
    legend: { top: 64, textStyle: { color: "#a09b8c" } },
    radar: {
      center: ["50%", "57%"],
      radius: "62%",
      indicator: categories.map((name, index) => ({
        name,
        max: maxima[index] ?? 1,
      })),
      axisName: { color: "#f0e6d2" },
      splitLine: { lineStyle: { color: "#3c3c41" } },
    },
    series: [
      {
        type: "radar",
        data: snapshot.series.map((series) => ({
          name: series.label,
          value: categories.map(
            (category) =>
              series.points.find((point) => point.label === category)?.value ??
              0,
          ),
        })),
      },
    ],
  };
}

function baseOption(snapshot: VisualizationSnapshot): echarts.EChartsOption {
  return {
    backgroundColor: "#091428",
    animation: false,
    color: ["#c8aa6e", "#0ac8b9", "#785a28", "#0397ab", "#a09b8c"],
    textStyle: { color: "#f0e6d2" },
    title: {
      text: snapshot.title ?? "Scout analysis",
      left: 28,
      top: 18,
      textStyle: { color: "#c8aa6e", fontSize: 28 },
    },
  };
}
