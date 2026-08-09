import type {
  TemporalSeriesPoint,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import type * as echarts from "echarts";
import {
  donutOption,
  heatmapOption,
  radarOption,
} from "#src/html/visualization-snapshot-special-options.ts";

export type VisualizationOptionMode = "interactive" | "static";

export function visualizationSnapshotToOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationOptionMode,
): echarts.EChartsOption {
  if (snapshot.kind === "CALENDAR_HEATMAP") {
    return calendarOption(snapshot, mode);
  }
  if (snapshot.kind === "KPI_CARD") {
    return kpiOption(snapshot, mode);
  }
  if (snapshot.kind === "DONUT_CHART") {
    return donutOption(snapshot);
  }
  if (snapshot.kind === "HEATMAP") {
    return heatmapOption(snapshot, mode === "interactive");
  }
  if (snapshot.kind === "RADAR_CHART") {
    return radarOption(snapshot);
  }
  const categories = categoryPoints(snapshot).map((point) => point.label);
  const tooltip: echarts.TooltipComponentOption = {
    trigger: "axis",
    axisPointer: { type: "cross" },
    formatter: (input) => tooltipText(snapshot, input),
  };
  const points = categoryPoints(snapshot);
  const annotations = snapshot.annotations.flatMap((annotation) => {
    const point =
      points.find((candidate) => candidate.start >= annotation.timestamp) ??
      points.at(-1);
    return point === undefined
      ? []
      : [
          {
            xAxis: point.label,
            name: annotation.label,
            label: { formatter: annotation.label },
          },
        ];
  });
  const series: echarts.SeriesOption[] = [
    ...snapshot.series.map((item, index) =>
      snapshotSeriesOption({
        snapshot,
        item,
        index,
        categories,
        annotations,
      }),
    ),
    ...evidenceOverlaySeries(snapshot, categories),
    ...snapshot.trends.map(
      (trend): echarts.SeriesOption => ({
        name: `${trend.seriesId} trend (slope ${trend.slope.toFixed(3)}, R² ${trend.rSquared.toFixed(2)})`,
        type: "line",
        data: trend.values,
        symbol: "none",
        lineStyle: { type: "dashed", width: 2, opacity: 0.8 },
        tooltip: { show: false },
      }),
    ),
  ];
  return {
    backgroundColor: "#091428",
    animation: false,
    title: {
      text: snapshot.title ?? "Scout analysis",
      left: 28,
      top: 18,
      textStyle: { color: "#c8aa6e", fontSize: 28 },
    },
    color: ["#c8aa6e", "#0ac8b9", "#785a28", "#0397ab", "#a09b8c"],
    textStyle: { color: "#f0e6d2" },
    tooltip,
    legend: {
      type: "scroll",
      top: 62,
      textStyle: { color: "#a09b8c" },
    },
    grid: {
      left: 68,
      right: 36,
      top: 105,
      bottom: mode === "interactive" ? 92 : 58,
    },
    xAxis:
      snapshot.kind === "SCATTER_CHART"
        ? {
            type: "value",
            axisLabel: { color: "#a09b8c" },
            axisLine: { lineStyle: { color: "#3c3c41" } },
          }
        : {
            type: "category",
            data: categories,
            axisLabel: { color: "#a09b8c" },
            axisLine: { lineStyle: { color: "#3c3c41" } },
          },
    yAxis: {
      type: "value",
      inverse: snapshot.kind === "BUMP_CHART",
      ...(snapshot.kind === "BUMP_CHART" ? { min: 1, minInterval: 1 } : {}),
      axisLabel: { color: "#a09b8c" },
      splitLine: { lineStyle: { color: "#1e282d" } },
    },
    ...(mode === "interactive"
      ? {
          dataZoom: [{ type: "inside" }, { type: "slider", bottom: 20 }],
          brush: { toolbox: ["lineX", "clear"], xAxisIndex: "all" },
          toolbox: {
            right: 24,
            feature: {
              dataZoom: {},
              restore: {},
              saveAsImage: {},
            },
          },
        }
      : {}),
    series,
  };
}

function evidenceOverlaySeries(
  snapshot: VisualizationSnapshot,
  categories: string[],
): echarts.SeriesOption[] {
  const item = snapshot.series.length === 1 ? snapshot.series[0] : undefined;
  if (item === undefined || snapshot.kind === "SCATTER_CHART") return [];
  const comparison =
    snapshot.temporal?.comparison === undefined
      ? []
      : [
          {
            name: `${item.label} baseline`,
            type: "line" as const,
            data: categories.map(
              (category) =>
                item.points.find((point) => point.label === category)
                  ?.comparisonValue ?? null,
            ),
            symbol: "none",
            lineStyle: { type: "dotted" as const, width: 2, opacity: 0.65 },
          },
        ];
  const hasConfidence = item.points.some(
    (point) => point.evidence.confidenceInterval !== null,
  );
  if (!hasConfidence) return comparison;
  return [
    ...comparison,
    ...(["lower", "upper"] as const).map(
      (bound): echarts.SeriesOption => ({
        name: `${item.label} 95% CI ${bound}`,
        type: "line",
        data: categories.map((category) => {
          const interval = item.points.find((point) => point.label === category)
            ?.evidence.confidenceInterval;
          return interval?.[bound] ?? null;
        }),
        symbol: "none",
        lineStyle: { type: "dashed", width: 1, opacity: 0.35 },
        tooltip: { show: false },
      }),
    ),
  ];
}

function kpiOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationOptionMode,
): echarts.EChartsOption {
  const categories = categoryPoints(snapshot).map((point) => point.label);
  const columns = Math.min(4, Math.max(1, snapshot.series.length));
  return {
    backgroundColor: "#091428",
    animation: false,
    title: {
      text: snapshot.title ?? "Scout KPIs",
      left: 28,
      top: 18,
      textStyle: { color: "#c8aa6e", fontSize: 28 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (input) => tooltipText(snapshot, input),
    },
    graphic: snapshot.series.map((series, index) => {
      const latest = series.points.at(-1);
      const delta = latest?.absoluteDelta;
      const percent = latest?.percentageDelta;
      return {
        type: "group",
        left: `${((index % columns) * (100 / columns) + 2).toFixed(1)}%`,
        top: 82 + Math.floor(index / columns) * 92,
        children: [
          {
            type: "rect",
            shape: { width: 180, height: 72, r: 6 },
            style: { fill: "#111c2e", stroke: "#3c3c41", lineWidth: 1 },
          },
          {
            type: "text",
            left: 12,
            top: 9,
            style: {
              text: series.label,
              fill: "#a09b8c",
              font: "13px sans-serif",
            },
          },
          {
            type: "text",
            left: 12,
            top: 29,
            style: {
              text: `${formatValue(latest?.value ?? null)}  n=${(latest?.evidence.sampleSize ?? 0).toString()}`,
              fill: "#f0e6d2",
              font: "bold 18px sans-serif",
            },
          },
          {
            type: "text",
            left: 12,
            top: 53,
            style: {
              text:
                delta === undefined
                  ? ""
                  : `Δ ${formatValue(delta ?? null)} · ${formatPercent(percent ?? null)}`,
              fill: "#0ac8b9",
              font: "11px sans-serif",
            },
          },
        ],
      };
    }),
    grid: {
      left: 48,
      right: 30,
      top: Math.max(190, 88 + Math.ceil(snapshot.series.length / columns) * 92),
      bottom: mode === "interactive" ? 72 : 34,
    },
    xAxis: { type: "category", data: categories, show: false },
    yAxis: { type: "value", show: false },
    ...(mode === "interactive"
      ? { dataZoom: [{ type: "inside" }, { type: "slider", bottom: 18 }] }
      : {}),
    series: snapshot.series.map((series) => ({
      name: series.label,
      type: "line",
      data: categories.map(
        (category) =>
          series.points.find((point) => point.label === category)?.value ??
          null,
      ),
      symbol: "none",
      smooth: snapshot.display.smooth,
      lineStyle: { width: snapshot.display.sparkline ? 2 : 0 },
    })),
  };
}

function snapshotSeriesOption(context: {
  snapshot: VisualizationSnapshot;
  item: VisualizationSnapshot["series"][number];
  index: number;
  categories: string[];
  annotations: {
    xAxis: string;
    name: string;
    label: { formatter: string };
  }[];
}): echarts.SeriesOption {
  const { snapshot, item, index, categories, annotations } = context;
  if (snapshot.kind === "SCATTER_CHART") {
    return {
      id: item.id,
      name: item.label,
      type: "scatter",
      data: item.points.map((point, pointIndex) => ({
        value: [point.xValue ?? pointIndex, point.value],
        symbolSize: Math.max(6, Math.min(36, point.sizeValue ?? 10)),
      })),
    };
  }
  const common = {
    id: item.id,
    name: item.label,
    data: categories.map(
      (category) =>
        item.points.find((point) => point.label === category)?.value ?? null,
    ),
    ...(snapshot.display.stack === "none" ? {} : { stack: "total" }),
    ...(index === 0 && annotations.length > 0
      ? { markLine: { symbol: "none", data: annotations } }
      : {}),
  };
  if (snapshot.kind === "BAR_CHART" || snapshot.kind === "STACKED_BAR") {
    return { ...common, type: "bar" };
  }
  return {
    ...common,
    type: "line",
    smooth: snapshot.display.smooth,
    ...(snapshot.kind === "AREA_CHART" ? { areaStyle: { opacity: 0.28 } } : {}),
  };
}

function categoryPoints(
  snapshot: VisualizationSnapshot,
): TemporalSeriesPoint[] {
  const points = new Map<string, TemporalSeriesPoint>();
  for (const series of snapshot.series) {
    for (const point of series.points) points.set(point.label, point);
  }
  return [...points.values()].toSorted((left, right) =>
    left.start.localeCompare(right.start),
  );
}

function tooltipText(snapshot: VisualizationSnapshot, input: unknown): string {
  const params = Array.isArray(input) ? input : [input];
  const first = params[0];
  if (typeof first !== "object" || first === null || !("dataIndex" in first)) {
    return "";
  }
  const dataIndexValue = first.dataIndex;
  if (typeof dataIndexValue !== "number") return "";
  const point = categoryPoints(snapshot)[dataIndexValue];
  if (point === undefined) return "";
  const lines = [`<strong>${point.label}</strong>`];
  for (const series of snapshot.series) {
    const value = series.points.find(
      (candidate) => candidate.label === point.label,
    );
    if (value === undefined) continue;
    lines.push(
      `${series.label}: ${formatValue(value.value)} (n=${value.evidence.sampleSize.toString()})`,
    );
    if (snapshot.temporal?.comparison !== undefined) {
      lines.push(
        `Baseline: ${formatValue(value.comparisonValue ?? null)} · Δ ${formatValue(value.absoluteDelta ?? null)} · ${formatPercent(value.percentageDelta ?? null)}`,
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

function formatValue(value: number | null): string {
  return value === null
    ? "Unknown"
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}

function calendarOption(
  snapshot: VisualizationSnapshot,
  mode: VisualizationOptionMode,
): echarts.EChartsOption {
  const series = snapshot.series[0];
  const points = series?.points ?? [];
  const values = points.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  return {
    backgroundColor: "#091428",
    animation: false,
    title: {
      text: snapshot.title ?? "Scout calendar",
      left: 28,
      top: 18,
      textStyle: { color: "#c8aa6e", fontSize: 28 },
    },
    tooltip: {
      formatter: (input) => {
        if (!("data" in input)) return "";
        const data = input.data;
        if (!Array.isArray(data)) return "";
        return `${String(data[0])}: ${String(data[1])}`;
      },
    },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      calculable: mode === "interactive",
      orient: "horizontal",
      left: "center",
      bottom: 18,
      textStyle: { color: "#a09b8c" },
      inRange: { color: ["#1e282d", "#0ac8b9", "#c8aa6e"] },
    },
    calendar: {
      top: 90,
      left: 48,
      right: 36,
      bottom: 78,
      range:
        points.length === 0
          ? new Date().getUTCFullYear().toString()
          : [points[0]?.label ?? "", points.at(-1)?.label ?? ""],
      itemStyle: { color: "#1e282d", borderColor: "#091428", borderWidth: 3 },
      dayLabel: { color: "#a09b8c" },
      monthLabel: { color: "#f0e6d2" },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: points.flatMap((point) =>
          point.value === null ? [] : [[point.label, point.value]],
        ),
      },
    ],
  };
}
