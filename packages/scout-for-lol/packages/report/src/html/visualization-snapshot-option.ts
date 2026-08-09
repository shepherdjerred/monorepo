import type {
  TemporalSeriesPoint,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import type * as echarts from "echarts";
import { calendarTooltipText } from "#src/html/visualization-calendar-tooltip.ts";
import {
  donutOption,
  heatmapOption,
  radarOption,
} from "#src/html/visualization-snapshot-special-options.ts";
import {
  formatPercent,
  formatSeriesAbsoluteDelta,
  formatSeriesValue,
  usesPercentageAxis,
} from "#src/html/visualization-value-format.ts";
import {
  pointTooltipText,
  scatterTooltipText,
} from "#src/html/visualization-tooltip.ts";
import { alignedTrendValues } from "#src/html/visualization-trend-values.ts";

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
    trigger: snapshot.kind === "SCATTER_CHART" ? "item" : "axis",
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
        data: alignedTrendValues(snapshot, trend, categories),
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
      axisLabel: {
        color: "#a09b8c",
        ...(usesPercentageAxis(snapshot) ? { formatter: formatPercent } : {}),
      },
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
  if (snapshot.kind === "SCATTER_CHART") return [];
  const comparison =
    snapshot.temporal?.comparison === undefined
      ? []
      : snapshot.series.map(
          (item): echarts.SeriesOption => ({
            name: `${item.label} baseline`,
            type: "line",
            data: categories.map(
              (category) =>
                item.points.find((point) => point.label === category)
                  ?.comparisonValue ?? null,
            ),
            symbol: "none",
            lineStyle: { type: "dotted", width: 2, opacity: 0.65 },
          }),
        );
  return [
    ...comparison,
    ...snapshot.series.flatMap((item) =>
      item.points.some((point) => point.evidence.confidenceInterval !== null)
        ? (["lower", "upper"] as const).map(
            (bound): echarts.SeriesOption => ({
              name: `${item.label} 95% CI ${bound}`,
              type: "line",
              data: categories.map((category) => {
                const interval = item.points.find(
                  (point) => point.label === category,
                )?.evidence.confidenceInterval;
                return interval?.[bound] ?? null;
              }),
              symbol: "none",
              lineStyle: { type: "dashed", width: 1, opacity: 0.35 },
              tooltip: { show: false },
            }),
          )
        : [],
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
              text: `${formatSeriesValue(snapshot, series, latest?.value ?? null)}  n=${(latest?.evidence.sampleSize ?? 0).toString()}`,
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
                  : `Δ ${formatSeriesAbsoluteDelta(snapshot, series, delta ?? null)} · ${formatPercent(percent ?? null)}`,
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
      data: item.points.flatMap((point) => {
        const xValue = point.xValue;
        return xValue === undefined || xValue === null
          ? []
          : [
              {
                name: point.label,
                value: [xValue, point.value],
                symbolSize: Math.max(6, Math.min(36, point.sizeValue ?? 10)),
              },
            ];
      }),
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

export function tooltipText(
  snapshot: VisualizationSnapshot,
  input: unknown,
): string {
  const params = Array.isArray(input) ? input : [input];
  const first = params[0];
  if (typeof first !== "object" || first === null || !("dataIndex" in first)) {
    return "";
  }
  const dataIndexValue = first.dataIndex;
  if (typeof dataIndexValue !== "number") return "";
  if (snapshot.kind === "SCATTER_CHART") {
    return scatterTooltipText(snapshot, first, dataIndexValue);
  }
  const point = categoryPoints(snapshot)[dataIndexValue];
  if (point === undefined) return "";
  return pointTooltipText(snapshot, point, snapshot.series);
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
      formatter: (input) => calendarTooltipText(snapshot, input),
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
          ? emptyCalendarRange(snapshot)
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
          point.value === null
            ? []
            : [
                [
                  point.label,
                  point.value,
                  point.comparisonValue ?? null,
                  point.absoluteDelta ?? null,
                  point.percentageDelta ?? null,
                  point.evidence.sampleSize,
                ],
              ],
        ),
      },
    ],
  };
}

function emptyCalendarRange(
  snapshot: VisualizationSnapshot,
): string | [string, string] {
  const temporal = snapshot.temporal;
  if (temporal?.window.kind === "calendar") {
    return [temporal.window.startDate, temporal.window.endDate];
  }
  const generatedAt = new Date(snapshot.generatedAt);
  if (temporal?.window.kind === "relative") {
    return [
      calendarDateInTimezone(
        new Date(generatedAt.getTime() - temporal.window.days * 86_400_000),
        temporal.timezone,
      ),
      calendarDateInTimezone(generatedAt, temporal.timezone),
    ];
  }
  return generatedAt.getUTCFullYear().toString();
}

function calendarDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format calendar range in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}
