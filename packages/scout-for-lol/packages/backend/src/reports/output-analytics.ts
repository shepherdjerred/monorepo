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
import { planGroupingNames } from "#src/reports/plan-columns.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";

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
      | "CALENDAR_HEATMAP"
      | "HISTOGRAM"
      | "BOX_PLOT";
  }
>;

type AnalyticsRenderContext = {
  result: ReportQueryResult;
  plan: ScoutQlPlan;
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
  const plan = input.result.plan;
  const columns = yColumns(input.result, input.render);
  const firstColumn = requireFirst(columns);
  const display = columnDisplay(plan, firstColumn);
  const rows = chartRows(plan, input.result.rows, input.render, firstColumn);
  const context: AnalyticsRenderContext = {
    result: input.result,
    plan,
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
    .with("HISTOGRAM", "BOX_PLOT", (kind): Buffer => {
      // These kinds render exclusively from the visualization snapshot
      // (renderSnapshotOutput); a query that produced neither a snapshot nor
      // an earlier error reaching this legacy path is a bug, not a fallback.
      throw new Error(`RENDER ${kind} requires a visualization snapshot.`);
    })
    .exhaustive();
}

function renderBumpAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, rows, plan } = context;
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
        return row === undefined ? null : chartNumber(plan, row, firstColumn);
      }),
    })),
    yAxisLabel: "Rank position",
    smooth: false,
  });
}

function renderCalendarHeatmapAnalytics(
  context: AnalyticsRenderContext,
): Buffer {
  const { base, firstColumn, rows, plan } = context;
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
    valueSuffix: columnDisplay(plan, firstColumn).percent ? "%" : "",
    cells: rows.map((row) => {
      const date = parseISO(row.dimensions.at(-1) ?? row.label);
      return {
        x: weeks.indexOf(format(startOfISOWeek(date), "MMM d")),
        y: getISODay(date) - 1,
        value: chartNumber(plan, row, firstColumn),
      };
    }),
  });
}

function renderCartesianAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, display, render, rows, plan } = context;
  return analyticsChartToImage({
    ...base,
    chartType: render.kind === "STACKED_BAR" ? "stacked_bar" : "area",
    categories: rows.map((row) => row.label),
    series: chartSeries(plan, rows, columns),
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
  const { base, display, firstColumn, rows, plan } = context;
  return analyticsChartToImage({
    ...base,
    chartType: "donut",
    valueSuffix: display.percent ? "%" : "",
    items: rows.map((row) => ({
      name: row.label,
      value: chartNumber(plan, row, firstColumn),
    })),
  });
}

function renderScatterAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, render, rows, plan } = context;
  const xColumn = render.encoding.x;
  if (xColumn === undefined) {
    throw new Error("Scatter charts require RENDER x.");
  }
  return analyticsChartToImage({
    ...base,
    chartType: "scatter",
    xAxisLabel: render.options.xAxisLabel ?? columnDisplay(plan, xColumn).label,
    yAxisLabel:
      render.options.yAxisLabel ?? columnDisplay(plan, firstColumn).label,
    points: rows.map((row) => ({
      name: row.label,
      x: chartNumber(plan, row, xColumn),
      y: chartNumber(plan, row, firstColumn),
      ...(render.encoding.size === undefined
        ? {}
        : { size: chartNumber(plan, row, render.encoding.size) }),
    })),
  });
}

function renderHeatmapAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, firstColumn, render, result, rows, plan } = context;
  const groupBys = planGroupingNames(result.plan);
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
    valueSuffix: columnDisplay(plan, valueColumn).percent ? "%" : "",
    cells: rows.map((row) => ({
      x: xCategories.indexOf(row.dimensions[xDim] ?? ""),
      y: yCategories.indexOf(row.dimensions[yDim] ?? ""),
      value: chartNumber(plan, row, valueColumn),
    })),
  });
}

function renderRadarAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, rows, plan } = context;
  return analyticsChartToImage({
    ...base,
    chartType: "radar",
    indicators: columns.map((column) => columnDisplay(plan, column).label),
    series: rows.map((row) => ({
      name: row.label,
      values: columns.map((column) => chartNumber(plan, row, column)),
    })),
  });
}

function renderKpiAnalytics(context: AnalyticsRenderContext): Buffer {
  const { base, columns, rows, plan } = context;
  const row = rows[0];
  if (row === undefined) throw new Error("KPI cards require one result row.");
  return analyticsChartToImage({
    ...base,
    chartType: "kpi",
    items: columns.map((column) => ({
      label: columnDisplay(plan, column).label,
      value: formattedChartValue(plan, row, column),
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
  const first = result.plan.outputs[0]?.name;
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
  plan: ScoutQlPlan,
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
      direction *
      (chartNumber(plan, left, column) - chartNumber(plan, right, column)),
  );
}
