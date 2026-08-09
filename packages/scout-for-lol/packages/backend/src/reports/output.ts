import {
  formatReportDisplayValue,
  reportResultColumns,
  type ReportRenderSpec,
} from "@scout-for-lol/data";
import {
  analyticsChartToImage,
  visualizationSnapshotToImage,
} from "@scout-for-lol/report";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import {
  formatRankedLabel,
  resolveMentionCount,
} from "#src/reports/mention-format.ts";
import {
  chartSeries,
  columnDisplay,
  chartNumber,
} from "#src/reports/report-chart-values.ts";
import { renderLegacyAnalyticsImage } from "#src/reports/output-analytics.ts";

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
      | "KPI_CARD"
      | "BUMP_CHART"
      | "CALENDAR_HEATMAP";
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
  const snapshotOutput = renderSnapshotOutput(params, render);
  if (snapshotOutput !== null) return snapshotOutput;
  if (render.kind === "BAR_CHART") return renderBarChart(params, render);
  if (render.kind === "LINE_CHART") return renderLineChart(params, render);
  if ("encoding" in render) return renderAnalyticsChart(params, render);
  return renderTextOutput(params, render);
}

function renderSnapshotOutput(
  params: RenderReportOutputParams,
  render: ReportRenderSpec,
): RenderedReportOutput | null {
  if (
    render.kind === "TABLE" &&
    render.options?.sparkline === true &&
    params.result.visualization !== undefined
  ) {
    return {
      content: formatTextReport(params.title, render, params.result, {
        ...(params.playerDiscordIds === undefined
          ? {}
          : { playerDiscordIds: params.playerDiscordIds }),
      }),
      image: {
        filename: "report-table-sparklines.png",
        data: visualizationSnapshotToImage({
          ...params.result.visualization,
          title: params.title,
        }),
      },
    };
  }
  if ("encoding" in render && params.result.visualization !== undefined) {
    const title = render.options.title ?? params.title;
    return {
      content: `**${title}**`,
      image: {
        filename: `report-${render.kind.toLowerCase().replaceAll("_", "-")}.png`,
        data: visualizationSnapshotToImage({
          ...params.result.visualization,
          title,
        }),
      },
    };
  }
  return null;
}

function renderTextOutput(
  params: RenderReportOutputParams,
  render: Exclude<ReportRenderSpec, ChartRender>,
): RenderedReportOutput {
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
  const data = renderLegacyAnalyticsImage({
    title,
    result: params.result,
    render,
  });
  return {
    content: `**${title}**`,
    image: {
      filename: `report-${render.kind.toLowerCase().replaceAll("_", "-")}.png`,
      data,
    },
  };
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
