import {
  reportColumnLabel,
  type ReportGroupBy,
  type ReportOutputFormat,
} from "@scout-for-lol/data";
import {
  competitionChartToImage,
  competitionChartToSvg,
  type CompetitionChartProps,
} from "@scout-for-lol/report";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";

export type RenderedReportOutput = {
  content: string;
  image: { filename: string; data: Buffer } | null;
};

// Lightweight preview output for the web UI. Mirrors the real report exactly:
// text formats return the same markdown string the bot posts; chart formats
// return an SVG (cheaper than the PNG/resvg path and crisp in the browser).
export type ReportPreviewOutput =
  | { kind: "text"; content: string }
  | { kind: "chart"; svg: string };

type RenderReportOutputParams = {
  title: string;
  outputFormat: ReportOutputFormat;
  result: ReportQueryResult;
  startedAt: Date;
};

export async function renderReportOutput(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  if (params.outputFormat === "BAR_CHART") {
    return await renderBarChart(params);
  }

  if (params.outputFormat === "LINE_CHART") {
    return await renderLineChart(params);
  }

  return {
    content: formatTextReport(params.title, params.outputFormat, params.result),
    image: null,
  };
}

// Renders the report the way the web preview shows it: identical text for text
// formats, an SVG string (not a PNG) for chart formats.
export function renderReportPreview(
  params: RenderReportOutputParams,
): ReportPreviewOutput {
  if (params.outputFormat === "BAR_CHART") {
    return {
      kind: "chart",
      svg: competitionChartToSvg(buildReportChartProps(params, "bar")),
    };
  }

  if (params.outputFormat === "LINE_CHART") {
    return {
      kind: "chart",
      svg: competitionChartToSvg(buildReportChartProps(params, "line")),
    };
  }

  return {
    kind: "text",
    content: formatTextReport(params.title, params.outputFormat, params.result),
  };
}

function formatTextReport(
  title: string,
  outputFormat: ReportOutputFormat,
  result: ReportQueryResult,
): string {
  if (result.rows.length === 0) {
    return `**${title}**\nNo rows matched this report.`;
  }

  if (outputFormat === "TABLE") {
    return `**${title}**\n${formatTable(result)}`;
  }

  if (outputFormat === "LIST") {
    return `**${title}**\n${result.rows
      .map((row) => `- ${row.label}: ${formatValues(row, result.plan.groupBy)}`)
      .join("\n")}`;
  }

  return `**${title}**\n${result.rows
    .map(
      (row, index) =>
        `${(index + 1).toString()}. ${row.label} — ${formatValues(
          row,
          result.plan.groupBy,
        )}`,
    )
    .join("\n")}`;
}

function formatTable(result: ReportQueryResult): string {
  const header = result.columns
    .map((column) => reportColumnLabel(column, result.plan.groupBy))
    .join(" | ");
  const separator = result.columns.map(() => "---").join(" | ");
  const body = result.rows
    .map((row) =>
      [
        row.label,
        ...row.values.map((value) => formatReportValue(value.value)),
      ].join(" | "),
    )
    .join("\n");
  return `\`\`\`\n${header}\n${separator}\n${body}\n\`\`\``;
}

function formatValues(row: ReportResultRow, groupBy: ReportGroupBy): string {
  return row.values
    .map(
      (value) =>
        `${reportColumnLabel(value.column, groupBy)}: ${formatReportValue(
          value.value,
        )}`,
    )
    .join(", ");
}

function formatReportValue(value: number | string): string {
  if (typeof value === "string") {
    return value;
  }

  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(2);
}

async function renderBarChart(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  const data = await competitionChartToImage(
    buildReportChartProps(params, "bar"),
  );

  return {
    content: `**${params.title}**`,
    image: { filename: "report-bar-chart.png", data },
  };
}

async function renderLineChart(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  const data = await competitionChartToImage(
    buildReportChartProps(params, "line"),
  );

  return {
    content: `**${params.title}**`,
    image: { filename: "report-line-chart.png", data },
  };
}

// Shared mapping from a query result to ECharts props, used by both the real
// report (PNG via competitionChartToImage) and the live preview (SVG).
function buildReportChartProps(
  params: RenderReportOutputParams,
  chartType: "bar" | "line",
): CompetitionChartProps {
  const metric = params.result.plan.metrics[0];
  if (metric === undefined) {
    throw new Error("Cannot render report chart without at least one metric");
  }

  const yAxisLabel = reportColumnLabel(metric, params.result.plan.groupBy);
  const subtitle = reportSubtitle(params.result);

  if (chartType === "line") {
    return {
      chartType: "line",
      title: params.title,
      subtitle,
      yAxisLabel,
      startDate: params.startedAt,
      endDate: params.startedAt,
      series: params.result.rows.map((row) => ({
        playerName: row.label,
        points: [{ date: params.startedAt, value: firstNumericValue(row) }],
      })),
    };
  }

  return {
    chartType: "bar",
    title: params.title,
    subtitle,
    yAxisLabel,
    bars: params.result.rows.map((row) => ({
      playerName: row.label,
      value: firstNumericValue(row),
    })),
  };
}

function firstNumericValue(row: ReportResultRow): number {
  const value = row.values[0]?.value ?? 0;
  return typeof value === "number" ? value : 0;
}

function reportSubtitle(result: ReportQueryResult): string {
  return `${result.rows.length.toString()} row(s), ${result.rowsScanned.toString()} fact row(s) scanned`;
}
