import {
  formatReportDisplayValue,
  reportResultColumns,
  type ReportRenderSpec,
} from "@scout-for-lol/data";
import { analyticsChartToImage } from "@scout-for-lol/report";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import {
  formatRankedLabel,
  resolveMentionCount,
} from "#src/reports/mention-format.ts";
import {
  chartNumber,
  chartSeries,
  columnDisplay,
  formattedChartValue,
  uniqueDimensions,
  type MetricDisplay,
} from "#src/reports/report-chart-values.ts";

export type RenderedReportOutput = {
  content: string;
  image: { filename: string; data: Buffer } | null;
};

type RenderReportOutputParams = {
  title: string;
  result: ReportQueryResult;
  startedAt: Date;
  /**
   * Player ID → Discord ID, used for structured player-group mentions in
   * ranked text reports. Omitted for chart-only render paths (e.g. the tRPC
   * preview mutation), which never reach `formatTextReport`.
   */
  playerDiscordIds?: Map<number, string>;
};

type ChartRender = Extract<
  ReportRenderSpec,
  {
    kind:
      | "BAR_CHART"
      | "LINE_CHART"
      | "STACKED_BAR"
      | "AREA_CHART"
      | "DONUT_CHART"
      | "SCATTER_CHART"
      | "HEATMAP"
      | "RADAR_CHART"
      | "KPI_CARD";
  }
>;

export function renderReportOutput(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  return Promise.resolve(renderReportOutputSync(params));
}

function renderReportOutputSync(
  params: RenderReportOutputParams,
): RenderedReportOutput {
  const render = params.result.plan.render;
  if (render.kind === "BAR_CHART") {
    return renderBarChart(params, render);
  }
  if (render.kind === "LINE_CHART") {
    return renderLineChart(params, render);
  }
  if (
    render.kind === "STACKED_BAR" ||
    render.kind === "AREA_CHART" ||
    render.kind === "DONUT_CHART" ||
    render.kind === "SCATTER_CHART" ||
    render.kind === "HEATMAP" ||
    render.kind === "RADAR_CHART" ||
    render.kind === "KPI_CARD"
  ) {
    return renderAnalyticsChart(params, render);
  }
  return {
    content: formatTextReport(params.title, render, params.result, {
      ...(params.playerDiscordIds === undefined
        ? {}
        : { playerDiscordIds: params.playerDiscordIds }),
    }),
    image: null,
  };
}

type MentionOptions = { playerDiscordIds?: Map<number, string> };

function formatTextReport(
  title: string,
  render: Exclude<ReportRenderSpec, ChartRender>,
  result: ReportQueryResult,
  mentions: MentionOptions,
): string {
  if (result.rows.length === 0) {
    return `**${title}**\nNo rows matched this report.`;
  }

  if (render.kind === "TABLE") {
    return `**${title}**\n${formatTable(result)}`;
  }

  if (render.kind === "LIST") {
    return `**${title}**\n${result.rows
      .map((row) => `- ${row.label}: ${formatValues(result, row)}`)
      .join("\n")}`;
  }

  const mentionCount = resolveMentionCount(
    render.options.mentions,
    result.rows.length,
  );
  return `**${title}**\n${result.rows
    .map(
      (row, index) =>
        `${(index + 1).toString()}. ${formatRankedLabel({
          label: row.label,
          index,
          mentionIdentity: row.mentionIdentity,
          ...(mentions.playerDiscordIds === undefined
            ? {}
            : { playerDiscordIds: mentions.playerDiscordIds }),
          mentionCount,
        })} — ${formatValues(result, row)}`,
    )
    .join("\n")}`;
}

function formatTable(result: ReportQueryResult): string {
  const columns = reportResultColumns(result.plan, result.columns);
  const header = columns.map((column) => column.label).join(" | ");
  const separator = columns.map(() => "---").join(" | ");
  const body = result.rows
    .map((row) =>
      columns
        .map((column) => {
          if (column.key === "label") {
            return row.label;
          }
          const value = row.values.find(
            (entry) => entry.column === column.key,
          )?.value;
          return value === undefined || value === null
            ? "—"
            : formatReportDisplayValue(column, value);
        })
        .join(" | "),
    )
    .join("\n");
  return `\`\`\`\n${header}\n${separator}\n${body}\n\`\`\``;
}

function formatValues(result: ReportQueryResult, row: ReportResultRow): string {
  const columns = reportResultColumns(result.plan, result.columns);
  return row.values
    .map((value) => {
      const column = columns.find((entry) => entry.key === value.column);
      if (column === undefined) {
        throw new Error(`Missing report column ${value.column}`);
      }
      return value.value === null
        ? `${column.label}: —`
        : `${column.label}: ${formatReportDisplayValue(column, value.value)}`;
    })
    .join(", ");
}

function renderBarChart(
  params: RenderReportOutputParams,
  render: Extract<ReportRenderSpec, { kind: "BAR_CHART" }>,
): RenderedReportOutput {
  const columns = yColumns(params, render);
  const firstColumn = requireFirst(columns);
  const display = columnDisplay(firstColumn);
  const rows = chartRows(params.result.rows, render, firstColumn);
  const title = render.options.title ?? params.title;
  const data = analyticsChartToImage({
    ...chartBase(render, title),
    chartType: "bar",
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
  });
  return {
    content: `**${title}**`,
    image: { filename: "report-bar-chart.png", data },
  };
}

function renderLineChart(
  params: RenderReportOutputParams,
  render: Extract<ReportRenderSpec, { kind: "LINE_CHART" }>,
): RenderedReportOutput {
  const columns = yColumns(params, render);
  const firstColumn = requireFirst(columns);
  const display = columnDisplay(firstColumn);
  const rows = chartRows(params.result.rows, render, firstColumn);
  const title = render.options.title ?? params.title;
  const data = analyticsChartToImage({
    ...chartBase(render, title),
    chartType: "line",
    categories: rows.map((row) => row.label),
    series: chartSeries(rows, columns),
    yAxisLabel: render.options.yAxisLabel ?? display.label,
    valueSuffix: display.percent ? "%" : "",
    ...(render.options.xAxisLabel === undefined
      ? {}
      : { xAxisLabel: render.options.xAxisLabel }),
    ...(render.options.smooth === undefined
      ? {}
      : { smooth: render.options.smooth }),
  });
  return {
    content: `**${title}**`,
    image: { filename: "report-line-chart.png", data },
  };
}

function renderAnalyticsChart(
  params: RenderReportOutputParams,
  render: Exclude<ChartRender, { kind: "BAR_CHART" | "LINE_CHART" }>,
): RenderedReportOutput {
  const title = render.options.title ?? params.title;
  const base = chartBase(render, title);
  const data = renderAnalyticsImage(params, render, base);
  return {
    content: `**${title}**`,
    image: {
      filename: `report-${render.kind.toLowerCase().replaceAll("_", "-")}.png`,
      data,
    },
  };
}

function renderAnalyticsImage(
  params: RenderReportOutputParams,
  render: Exclude<ChartRender, { kind: "BAR_CHART" | "LINE_CHART" }>,
  base: ReturnType<typeof chartBase>,
): Buffer {
  const columns = yColumns(params, render);
  const firstColumn = requireFirst(columns);
  const display = columnDisplay(firstColumn);
  const rows = chartRows(params.result.rows, render, firstColumn);
  const context = { params, render, base, columns, firstColumn, display, rows };
  switch (render.kind) {
    case "STACKED_BAR":
    case "AREA_CHART":
      return renderCartesianAnalytics(context);
    case "DONUT_CHART":
      return renderDonutAnalytics(context);
    case "SCATTER_CHART":
      return renderScatterAnalytics(context);
    case "HEATMAP":
      return renderHeatmapAnalytics(context);
    case "RADAR_CHART":
      return renderRadarAnalytics(context);
    case "KPI_CARD":
      return renderKpiAnalytics(context);
  }
}

type AnalyticsRenderContext = {
  params: RenderReportOutputParams;
  render: Exclude<ChartRender, { kind: "BAR_CHART" | "LINE_CHART" }>;
  base: ReturnType<typeof chartBase>;
  columns: string[];
  firstColumn: string;
  display: MetricDisplay;
  rows: ReportResultRow[];
};

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
  if (xColumn === undefined)
    throw new Error("Scatter charts require RENDER x.");
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
  const { base, firstColumn, params, render, rows } = context;
  const groupBys = params.result.plan.groupBys;
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

/**
 * Resolve which of the two heatmap GROUP BY dimensions drives each axis. The
 * `x` encoding names the x-axis dimension and `series` the y-axis dimension;
 * either one fixes the split. With neither given, fall back to query order
 * (x = first GROUP BY, y = second).
 */
export function resolveHeatmapAxes(
  groupBys: readonly string[],
  encoding: { x?: string | undefined; series?: string | undefined },
): { xDim: number; yDim: number } {
  const xFromX = heatmapDimensionIndex(groupBys, encoding.x);
  const xFromSeries = heatmapDimensionIndex(groupBys, encoding.series);
  const xDim =
    xFromX ?? (xFromSeries === undefined ? 0 : xFromSeries === 0 ? 1 : 0);
  return { xDim, yDim: xDim === 0 ? 1 : 0 };
}

function heatmapDimensionIndex(
  groupBys: readonly string[],
  channel: string | undefined,
): number | undefined {
  if (channel === undefined) return undefined;
  const index = groupBys.indexOf(channel);
  return index === -1 ? undefined : index;
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

function chartBase(render: ChartRender, title: string) {
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

function yColumns(
  params: RenderReportOutputParams,
  render: ChartRender,
): string[] {
  const configured = render.encoding.y;
  if (Array.isArray(configured)) return configured;
  if (configured !== undefined) return [configured];
  const first = params.result.plan.selectItems[0]?.key;
  if (first === undefined)
    throw new Error("Cannot render a chart without an output column.");
  return [first];
}

function requireFirst(columns: string[]): string {
  const first = columns[0];
  if (first === undefined)
    throw new Error("Chart requires at least one Y column.");
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
