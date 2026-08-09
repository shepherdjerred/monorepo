import { type ReportRenderSpec } from "@scout-for-lol/data";
import {
  analyticsChartToImage,
  type AnalyticsChartProps,
} from "@scout-for-lol/report";
import { format, getISODay, parseISO, startOfISOWeek } from "date-fns";
import { match } from "ts-pattern";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import {
  chartNumber,
  chartSeries,
  columnDisplay,
  formattedChartValue,
  uniqueDimensions,
  type MetricDisplay,
} from "#src/reports/report-chart-values.ts";
import { resolveHeatmapAxes } from "#src/reports/heatmap-axes.ts";

type ChartRender = Extract<
  ReportRenderSpec,
  {
    kind:
      | "STACKED_BAR"
      | "AREA_CHART"
      | "DONUT_CHART"
      | "SCATTER_CHART"
      | "HEATMAP"
      | "RADAR_CHART"
      | "KPI_CARD"
      | "BUMP_CHART"
      | "CALENDAR_HEATMAP";
  }
>;

type AnalyticsRenderContext = {
  result: ReportQueryResult;
  render: ChartRender;
  base: AnalyticsChartBase;
  columns: string[];
  firstColumn: string;
  display: MetricDisplay;
  rows: ReportResultRow[];
};

type AnalyticsChartBase = Pick<
  AnalyticsChartProps,
  "title" | "subtitle" | "theme" | "palette" | "colors" | "legend" | "labels"
>;

export function renderLegacyAnalyticsImage(input: {
  title: string;
  result: ReportQueryResult;
  render: ChartRender;
}): Buffer {
  const columns = yColumns(input.result, input.render);
  const firstColumn = requireFirst(columns);
  const display = columnDisplay(firstColumn);
  const rows = chartRows(input.result.rows, input.render, firstColumn);
  const context: AnalyticsRenderContext = {
    result: input.result,
    render: input.render,
    base: chartBase(input.render, input.title),
    columns,
    firstColumn,
    display,
    rows,
  };
  return match(input.render.kind)
    .with("STACKED_BAR", "AREA_CHART", () => renderCartesianAnalytics(context))
    .with("DONUT_CHART", () => renderDonutAnalytics(context))
    .with("SCATTER_CHART", () => renderScatterAnalytics(context))
    .with("HEATMAP", () => renderHeatmapAnalytics(context))
    .with("RADAR_CHART", () => renderRadarAnalytics(context))
    .with("KPI_CARD", () => renderKpiAnalytics(context))
    .with("BUMP_CHART", () => renderBumpAnalytics(context))
    .with("CALENDAR_HEATMAP", () => renderCalendarHeatmapAnalytics(context))
    .exhaustive();
}

function renderBumpAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, rows } = context;
  const categories = [
    ...new Set(rows.map((row) => row.dimensions.at(-1) ?? row.label)),
  ].toSorted();
  const players = [
    ...new Set(rows.map((row) => row.dimensions[0] ?? row.label)),
  ];
  return analyticsChartToImage({
    ...base,
    chartType: "line",
    categories,
    series: players.map((player) => ({
      name: player,
      values: categories.map((category) => {
        const row = rows.find(
          (candidate) =>
            candidate.dimensions[0] === player &&
            candidate.dimensions.at(-1) === category,
        );
        return row === undefined ? null : chartNumber(row, firstColumn);
      }),
    })),
    yAxisLabel: "Rank position",
    smooth: false,
  });
}

function renderCalendarHeatmapAnalytics(
  context: AnalyticsRenderContext,
): Buffer {
  const { base, firstColumn, rows } = context;
  const weeks = [
    ...new Set(
      rows.map((row) =>
        format(
          startOfISOWeek(parseISO(row.dimensions.at(-1) ?? row.label)),
          "MMM d",
        ),
      ),
    ),
  ];
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return analyticsChartToImage({
    ...base,
    chartType: "heatmap",
    xCategories: weeks,
    yCategories: weekdays,
    valueSuffix: columnDisplay(firstColumn).percent ? "%" : "",
    cells: rows.map((row) => {
      const date = parseISO(row.dimensions.at(-1) ?? row.label);
      return {
        x: weeks.indexOf(format(startOfISOWeek(date), "MMM d")),
        y: getISODay(date) - 1,
        value: chartNumber(row, firstColumn),
      };
    }),
  });
}

function renderCartesianAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, display, render, rows } = context;
  return analyticsChartToImage({
    ...base,
    chartType: render.kind === "STACKED_BAR" ? "stacked_bar" : "area",
    categories: rows.map((row) => row.label),
    series: chartSeries(rows, columns),
    yAxisLabel: render.options.yAxisLabel ?? display.label,
    valueSuffix: display.percent ? "%" : "",
    ...(render.options.xAxisLabel === undefined
      ? {}
      : { xAxisLabel: render.options.xAxisLabel }),
    ...(render.options.orientation === undefined
      ? {}
      : { orientation: render.options.orientation }),
    ...(render.options.smooth === undefined
      ? {}
      : { smooth: render.options.smooth }),
  });
}

function renderDonutAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, display, firstColumn, rows } = context;
  return analyticsChartToImage({
    ...base,
    chartType: "donut",
    valueSuffix: display.percent ? "%" : "",
    items: rows.map((row) => ({
      name: row.label,
      value: chartNumber(row, firstColumn),
    })),
  });
}

function renderScatterAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, render, rows } = context;
  const xColumn = render.encoding.x;
  if (xColumn === undefined) {
    throw new Error("Scatter charts require RENDER x.");
  }
  return analyticsChartToImage({
    ...base,
    chartType: "scatter",
    xAxisLabel: render.options.xAxisLabel ?? columnDisplay(xColumn).label,
    yAxisLabel: render.options.yAxisLabel ?? columnDisplay(firstColumn).label,
    points: rows.map((row) => ({
      name: row.label,
      x: chartNumber(row, xColumn),
      y: chartNumber(row, firstColumn),
      ...(render.encoding.size === undefined
        ? {}
        : { size: chartNumber(row, render.encoding.size) }),
    })),
  });
}

function renderHeatmapAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, render, result, rows } = context;
  const groupBys = result.plan.groupBys;
  if (groupBys.length !== 2) {
    throw new Error("Heatmaps require exactly two GROUP BY dimensions.");
  }
  const { xDim, yDim } = resolveHeatmapAxes(groupBys, render.encoding);
  const xCategories = uniqueDimensions(rows, xDim);
  const yCategories = uniqueDimensions(rows, yDim);
  const valueColumn = render.encoding.value ?? firstColumn;
  return analyticsChartToImage({
    ...base,
    chartType: "heatmap",
    xCategories,
    yCategories,
    valueSuffix: columnDisplay(valueColumn).percent ? "%" : "",
    cells: rows.map((row) => ({
      x: xCategories.indexOf(row.dimensions[xDim] ?? ""),
      y: yCategories.indexOf(row.dimensions[yDim] ?? ""),
      value: chartNumber(row, valueColumn),
    })),
  });
}

function renderRadarAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, rows } = context;
  return analyticsChartToImage({
    ...base,
    chartType: "radar",
    indicators: columns.map((column) => columnDisplay(column).label),
    series: rows.map((row) => ({
      name: row.label,
      values: columns.map((column) => chartNumber(row, column)),
    })),
  });
}

function renderKpiAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, rows } = context;
  const row = rows[0];
  if (row === undefined) throw new Error("KPI cards require one result row.");
  return analyticsChartToImage({
    ...base,
    chartType: "kpi",
    items: columns.map((column) => ({
      label: columnDisplay(column).label,
      value: formattedChartValue(row, column),
    })),
  });
}

function chartBase(render: ChartRender, title: string): AnalyticsChartBase {
  return {
    title,
    ...(render.options.subtitle === undefined
      ? {}
      : { subtitle: render.options.subtitle }),
    ...(render.options.theme === undefined
      ? {}
      : { theme: render.options.theme }),
    ...(render.options.palette === undefined
      ? {}
      : { palette: render.options.palette }),
    ...(render.options.colors === undefined
      ? {}
      : { colors: render.options.colors }),
    ...(render.options.legend === undefined
      ? {}
      : { legend: render.options.legend }),
    ...(render.options.labels === undefined
      ? {}
      : { labels: render.options.labels }),
  };
}

function yColumns(result: ReportQueryResult, render: ChartRender): string[] {
  const configured = render.encoding.y;
  if (Array.isArray(configured)) return configured;
  if (configured !== undefined) return [configured];
  const first = result.plan.selectItems[0]?.key;
  if (first === undefined) {
    throw new Error("Cannot render a chart without an output column.");
  }
  return [first];
}

function requireFirst(columns: string[]): string {
  const first = columns[0];
  if (first === undefined) {
    throw new Error("Chart requires at least one Y column.");
  }
  return first;
}

function chartRows(
  rows: ReportResultRow[],
  render: ChartRender,
  column: string,
): ReportResultRow[] {
  if (render.options.sort === undefined || render.options.sort === "query") {
    return rows;
  }
  const direction = render.options.sort === "asc" ? 1 : -1;
  return rows.toSorted(
    (left, right) =>
      direction * (chartNumber(left, column) - chartNumber(right, column)),
  );
}
