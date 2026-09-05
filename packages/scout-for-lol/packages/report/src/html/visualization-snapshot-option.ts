import type {
  TemporalSeriesPoint,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import { evidenceGames } from "@scout-for-lol/data";
import type * as echarts from "echarts";
import { calendarOption } from "#src/html/visualization-snapshot-calendar-option.ts";
import {
  boxPlotOption,
  histogramOption,
} from "#src/html/visualization-snapshot-distribution-option.ts";
import {
  donutOption,
  heatmapOption,
  radarOption,
} from "#src/html/visualization-snapshot-special-options.ts";
import {
  formatPercent,
  formatSnapshotAxisValue,
  formatSeriesAbsoluteDelta,
  formatSeriesValue,
} from "#src/html/visualization-value-format.ts";
import {
  pointTooltipText,
  scatterTooltipText,
} from "#src/html/visualization-tooltip.ts";
import { alignedTrendValues } from "#src/html/visualization-trend-values.ts";
import {
  VISUALIZATION_BODY_FONT,
  VISUALIZATION_DISPLAY_FONT,
  visualizationSnapshotAxis,
  visualizationSnapshotBaseOption,
  visualizationSnapshotLabels,
  visualizationSnapshotLegend,
  visualizationSnapshotPresentation,
} from "#src/html/visualization-snapshot-style.ts";

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
  if (snapshot.kind === "HISTOGRAM") {
    return histogramOption(snapshot, mode);
  }
  if (snapshot.kind === "BOX_PLOT") {
    return boxPlotOption(snapshot, mode);
  }
  const presentation = visualizationSnapshotPresentation(snapshot);
  const horizontal =
    presentation.options.orientation === "horizontal" &&
    (snapshot.kind === "BAR_CHART" || snapshot.kind === "STACKED_BAR");
  const categories = categoryPoints(snapshot).map((point) => point.label);
  const tooltip: echarts.TooltipComponentOption = {
    trigger: snapshot.kind === "SCATTER_CHART" ? "item" : "axis",
    axisPointer: { type: "cross" },
    formatter: (input) => tooltipText(snapshot, input),
    textStyle: { fontFamily: VISUALIZATION_BODY_FONT },
  };
  const points = categoryPoints(snapshot);
  const annotations = snapshot.annotations.flatMap((annotation) => {
    const point = points.find(
      (candidate) =>
        candidate.start <= annotation.timestamp &&
        candidate.end >= annotation.timestamp,
    );
    return point === undefined
      ? []
      : [
          {
            ...(horizontal ? { yAxis: point.label } : { xAxis: point.label }),
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
        horizontal,
      }),
    ),
    ...evidenceOverlaySeries(snapshot, categories),
    ...snapshot.trends.map((trend): echarts.SeriesOption => ({
      name: `${trend.seriesId} Trend`,
      type: "line",
      data: alignedTrendValues(snapshot, trend, categories),
      symbol: "none",
      lineStyle: { type: "dashed", width: 2, opacity: 0.8 },
      tooltip: { show: false },
    })),
  ];
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout analysis"),
    tooltip,
    legend: visualizationSnapshotLegend(presentation),
    grid: {
      left: 68,
      right: presentation.options.legend === "right" ? 220 : 36,
      top: 105,
      bottom: 58,
      containLabel: true,
    },
    xAxis: horizontal
      ? {
          type: "value",
          ...visualizationSnapshotAxis(
            presentation.theme,
            presentation.options.xAxisLabel,
          ),
          axisLabel: {
            color: presentation.theme.muted,
            fontFamily: VISUALIZATION_BODY_FONT,
            formatter: (value: number) =>
              formatSnapshotAxisValue(snapshot, value),
          },
        }
      : snapshot.kind === "SCATTER_CHART"
        ? {
            type: "value",
            ...visualizationSnapshotAxis(
              presentation.theme,
              presentation.options.xAxisLabel,
            ),
          }
        : {
            type: "category",
            data: categories,
            ...visualizationSnapshotAxis(
              presentation.theme,
              presentation.options.xAxisLabel,
            ),
          },
    yAxis: horizontal
      ? {
          type: "category",
          data: categories,
          ...visualizationSnapshotAxis(
            presentation.theme,
            presentation.options.yAxisLabel,
          ),
        }
      : {
          type: "value",
          inverse: snapshot.kind === "BUMP_CHART",
          ...(snapshot.kind === "BUMP_CHART" ? { min: 1, minInterval: 1 } : {}),
          ...visualizationSnapshotAxis(
            presentation.theme,
            presentation.options.yAxisLabel,
          ),
          axisLabel: {
            color: presentation.theme.muted,
            fontFamily: VISUALIZATION_BODY_FONT,
            formatter: (value: number) =>
              formatSnapshotAxisValue(snapshot, value),
          },
          splitLine: { lineStyle: { color: presentation.theme.grid } },
        },
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
      : snapshot.series.map((item): echarts.SeriesOption => ({
          name: `${item.label} baseline`,
          type: "line",
          data: categories.map(
            (category) =>
              item.points.find((point) => point.label === category)
                ?.comparisonValue ?? null,
          ),
          symbol: "none",
          lineStyle: { type: "dotted", width: 2, opacity: 0.65 },
        }));
  return comparison;
}

function kpiOption(
  snapshot: VisualizationSnapshot,
  _mode?: VisualizationOptionMode,
): echarts.EChartsOption {
  const categories = categoryPoints(snapshot).map((point) => point.label);
  const columns = Math.min(4, Math.max(1, snapshot.series.length));
  const presentation = visualizationSnapshotPresentation(snapshot);
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout KPIs"),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (input) => tooltipText(snapshot, input),
    },
    graphic: snapshot.series.map((series, index) => {
      const latest = series.points.at(-1);
      const delta = latest?.absoluteDelta;
      const percent = latest?.percentageDelta;
      const gameBasis =
        series.metric === "rank_position"
          ? ""
          : `  Based on ${evidenceGames(latest?.evidence ?? { sampleSize: 0 }).toString()} games`;
      return {
        type: "group",
        left: `${((index % columns) * (100 / columns) + 2).toFixed(1)}%`,
        top: 82 + Math.floor(index / columns) * 92,
        children: [
          {
            type: "rect",
            shape: { width: 180, height: 72, r: 6 },
            style: {
              fill: presentation.theme.panel,
              stroke: presentation.theme.border,
              lineWidth: 1,
            },
          },
          {
            type: "text",
            left: 12,
            top: 9,
            style: {
              text: series.label,
              fill: presentation.theme.muted,
              fontSize: 13,
              fontFamily: VISUALIZATION_BODY_FONT,
            },
          },
          {
            type: "text",
            left: 12,
            top: 29,
            style: {
              text: `${formatSeriesValue(snapshot, series, latest?.value ?? null)}${gameBasis}`,
              fill: presentation.theme.text,
              fontSize: 18,
              fontWeight: 700,
              fontFamily: VISUALIZATION_DISPLAY_FONT,
            },
          },
          {
            type: "text",
            left: 12,
            top: 53,
            style: {
              // The backend writes null (not undefined) when a query has no
              // `compare = previous_period`, so an undefined-only guard let
              // every comparison-less KPI card render "Δ Unknown · Unknown".
              text:
                delta === undefined || delta === null
                  ? ""
                  : `Δ ${formatSeriesAbsoluteDelta(snapshot, series, delta)} · ${formatPercent(percent ?? null)}`,
              fill: presentation.theme.accent,
              fontSize: 11,
              fontFamily: VISUALIZATION_BODY_FONT,
            },
          },
        ],
      };
    }),
    grid: {
      left: 48,
      right: 30,
      top: Math.max(190, 88 + Math.ceil(snapshot.series.length / columns) * 92),
      bottom: 34,
    },
    xAxis: { type: "category", data: categories, show: false },
    yAxis: { type: "value", show: false },
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
    xAxis?: string;
    yAxis?: string;
    name: string;
    label: { formatter: string };
  }[];
  horizontal: boolean;
}): echarts.SeriesOption {
  const { snapshot, item, index, categories, annotations, horizontal } =
    context;
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
                id: point.key,
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
    label: visualizationSnapshotLabels(
      snapshot.display.options ?? {},
      horizontal,
      false,
      (input) => snapshotSeriesLabel(snapshot, item, input),
    ),
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
  const ordered = [...points.values()].toSorted((left, right) =>
    snapshot.bucket === "patch"
      ? left.label.localeCompare(right.label, "en-US", { numeric: true })
      : left.start.localeCompare(right.start),
  );
  const sort = snapshot.display.options?.sort;
  if (sort === undefined || sort === "query" || snapshot.bucket !== null) {
    return ordered;
  }
  const direction = sort === "asc" ? 1 : -1;
  return ordered.toSorted(
    (left, right) =>
      direction *
      (categoryValue(snapshot, left.label) -
        categoryValue(snapshot, right.label)),
  );
}

function snapshotSeriesLabel(
  snapshot: VisualizationSnapshot,
  series: VisualizationSnapshot["series"][number],
  input: unknown,
): string {
  if (typeof input !== "object" || input === null || !("value" in input)) {
    return "";
  }
  return typeof input.value === "number"
    ? formatSeriesValue(snapshot, series, input.value)
    : "";
}

function categoryValue(snapshot: VisualizationSnapshot, label: string): number {
  return snapshot.series.reduce(
    (total, series) =>
      total +
      (series.points.find((point) => point.label === label)?.value ?? 0),
    0,
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
