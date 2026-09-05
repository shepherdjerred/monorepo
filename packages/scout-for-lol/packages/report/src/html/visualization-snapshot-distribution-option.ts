import type {
  TemporalSeries,
  TemporalSeriesPoint,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import type * as echarts from "echarts";
import { format as echartsFormat } from "echarts";
import { pointTooltipText } from "#src/html/visualization-tooltip.ts";
import {
  formatSeriesValue,
  formatSnapshotAxisValue,
} from "#src/html/visualization-value-format.ts";
import {
  visualizationSnapshotAxis,
  visualizationSnapshotBaseOption,
  visualizationSnapshotLabels,
  visualizationSnapshotLegend,
  visualizationSnapshotPresentation,
  visualizationSnapshotValueAxisLabel,
  type VisualizationRenderMode,
  type VisualizationSnapshotPresentation,
} from "#src/html/visualization-snapshot-style.ts";

/**
 * The `y = (min, q1, median, q3, max)` encoding a BOX_PLOT query must SELECT,
 * in order. The analyzer enforces the arity at compile time, so a snapshot
 * that arrives here with a different series count is a bug in the compiler,
 * not a user error — hence the throw rather than a partial render.
 */
const BOX_PLOT_ENCODING_ARITY = 5;

type BoxPlotRow = {
  label: string;
  values: number[];
};

/**
 * A histogram is one distribution: its single series carries the buckets in
 * ascending order, already labelled by the backend ("300–599"), with the
 * bucket count as the point value. Bars are drawn gapless with a hairline
 * border so adjacent bars read as bins rather than as independent categories.
 */
export function histogramOption(
  snapshot: VisualizationSnapshot,
  mode: "interactive" | "static",
): echarts.EChartsOption {
  const presentation = visualizationSnapshotPresentation(snapshot);
  // Explicitly one distribution: any further series are ignored, because a
  // second overlapping bin set is not a histogram.
  const distribution = snapshot.series[0];
  const points = distribution?.points ?? [];
  return {
    ...distributionFrame(snapshot, presentation, mode),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (input) =>
        distribution === undefined
          ? ""
          : histogramTooltipText(snapshot, distribution, points, input),
    },
    xAxis: distributionCategoryAxis(
      presentation,
      points.map((point) => point.label),
      mode,
    ),
    yAxis: distributionValueAxis(snapshot, presentation, mode),
    series:
      distribution === undefined
        ? []
        : [
            {
              id: distribution.id,
              name: distribution.label,
              type: "bar",
              data: points.map((point) => point.value),
              barCategoryGap: 0,
              barGap: "0%",
              itemStyle: {
                borderColor: presentation.theme.border,
                borderWidth: 1,
              },
              label: visualizationSnapshotLabels(presentation.options, false, {
                valueFormatter: (input) =>
                  seriesValueLabel(snapshot, distribution, input),
                mode,
              }),
            },
          ],
  };
}

/**
 * Five series zipped by point key into one boxplot category per key. Matching
 * by key rather than by index is load-bearing: a quantile series may be
 * missing a bucket the others have, and index alignment would silently shift
 * every later category onto the wrong bucket.
 */
export function boxPlotOption(
  snapshot: VisualizationSnapshot,
  mode: "interactive" | "static",
): echarts.EChartsOption {
  if (snapshot.series.length !== BOX_PLOT_ENCODING_ARITY) {
    throw new Error(
      `A BOX_PLOT snapshot must carry exactly ${BOX_PLOT_ENCODING_ARITY.toString()} series encoding (min, q1, median, q3, max); received ${snapshot.series.length.toString()}.`,
    );
  }
  const presentation = visualizationSnapshotPresentation(snapshot);
  const rows = boxPlotRows(snapshot);
  return {
    ...distributionFrame(snapshot, presentation, mode),
    tooltip: {
      trigger: "item",
      formatter: (input) => boxPlotTooltipText(snapshot, rows, input),
    },
    xAxis: distributionCategoryAxis(
      presentation,
      rows.map((row) => row.label),
      mode,
    ),
    yAxis: distributionValueAxis(snapshot, presentation, mode),
    series: [
      {
        name: "Distribution",
        type: "boxplot",
        data: rows.map((row) => row.values),
        itemStyle: { borderColor: presentation.theme.border },
      },
    ],
  };
}

/**
 * One category per point of the first (min) series, in that series' order.
 * A category any of the five series cannot answer is dropped outright: a
 * boxplot rendered from a partial five-number summary claims a spread that
 * was never measured.
 */
function boxPlotRows(snapshot: VisualizationSnapshot): BoxPlotRow[] {
  const anchors = snapshot.series[0]?.points ?? [];
  return anchors.flatMap((anchor) => {
    const values = snapshot.series.flatMap((series) => {
      const value = series.points.find(
        (point) => point.key === anchor.key,
      )?.value;
      return value === undefined || value === null ? [] : [value];
    });
    return values.length === snapshot.series.length
      ? [{ label: anchor.label, values }]
      : [];
  });
}

function distributionCategoryAxis(
  presentation: VisualizationSnapshotPresentation,
  categories: string[],
  mode: VisualizationRenderMode,
): echarts.XAXisComponentOption {
  return {
    type: "category",
    data: categories,
    ...visualizationSnapshotAxis(
      presentation.theme,
      presentation.options.xAxisLabel,
      mode,
    ),
  };
}

function distributionValueAxis(
  snapshot: VisualizationSnapshot,
  presentation: VisualizationSnapshotPresentation,
  mode: VisualizationRenderMode,
): echarts.YAXisComponentOption {
  return {
    type: "value",
    ...visualizationSnapshotAxis(
      presentation.theme,
      presentation.options.yAxisLabel,
      mode,
    ),
    axisLabel: visualizationSnapshotValueAxisLabel(
      presentation.theme,
      mode,
      (value) => formatSnapshotAxisValue(snapshot, value),
    ),
    splitLine: { lineStyle: { color: presentation.theme.grid } },
  };
}

function distributionFrame(
  snapshot: VisualizationSnapshot,
  presentation: VisualizationSnapshotPresentation,
  mode: VisualizationRenderMode,
): echarts.EChartsOption {
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout analysis", mode),
    legend: visualizationSnapshotLegend(presentation, "top", mode),
    grid: {
      left: 68,
      right: presentation.options.legend === "right" ? 220 : 36,
      top: 105,
      bottom: 58,
      containLabel: true,
    },
  };
}

function histogramTooltipText(
  snapshot: VisualizationSnapshot,
  distribution: TemporalSeries,
  points: TemporalSeriesPoint[],
  input: unknown,
): string {
  const index = hoveredDataIndex(input);
  if (index === undefined) return "";
  const point = points[index];
  return point === undefined
    ? ""
    : pointTooltipText(snapshot, point, [distribution]);
}

function boxPlotTooltipText(
  snapshot: VisualizationSnapshot,
  rows: BoxPlotRow[],
  input: unknown,
): string {
  const index = hoveredDataIndex(input);
  if (index === undefined) return "";
  const row = rows[index];
  if (row === undefined) return "";
  const summary = snapshot.series.flatMap((series, position) => {
    const value = row.values[position];
    return value === undefined
      ? []
      : [
          `${echartsFormat.encodeHTML(series.label)}: ${formatSeriesValue(snapshot, series, value)}`,
        ];
  });
  return [
    `<strong>${echartsFormat.encodeHTML(row.label)}</strong>`,
    ...summary.toReversed(),
  ].join("<br/>");
}

function hoveredDataIndex(input: unknown): number | undefined {
  const params = Array.isArray(input) ? input : [input];
  const first = params[0];
  if (typeof first !== "object" || first === null || !("dataIndex" in first)) {
    return undefined;
  }
  return typeof first.dataIndex === "number" ? first.dataIndex : undefined;
}

function seriesValueLabel(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  input: unknown,
): string {
  if (typeof input !== "object" || input === null || !("value" in input)) {
    return "";
  }
  const value = input.value;
  return typeof value === "number"
    ? formatSeriesValue(snapshot, series, value)
    : "";
}
