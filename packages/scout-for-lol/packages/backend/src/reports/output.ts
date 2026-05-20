import type { ReportOutputFormat } from "@scout-for-lol/data";
import { competitionChartToImage } from "@scout-for-lol/report";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";

export type RenderedReportOutput = {
  content: string;
  image: { filename: string; data: Buffer } | null;
};

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
      .map((row) => `- ${row.label}: ${formatValues(row)}`)
      .join("\n")}`;
  }

  return `**${title}**\n${result.rows
    .map(
      (row, index) =>
        `${(index + 1).toString()}. ${row.label} — ${formatValues(row)}`,
    )
    .join("\n")}`;
}

function formatTable(result: ReportQueryResult): string {
  const header = result.columns.join(" | ");
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

function formatValues(row: ReportResultRow): string {
  return row.values
    .map((value) => `${value.column}: ${formatReportValue(value.value)}`)
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
  const metric = params.result.plan.metrics[0];
  if (metric === undefined) {
    throw new Error("Cannot render report chart without at least one metric");
  }

  const data = await competitionChartToImage({
    chartType: "bar",
    title: params.title,
    subtitle: reportSubtitle(params.result),
    yAxisLabel: metric,
    bars: params.result.rows.map((row) => ({
      playerName: row.label,
      value: firstNumericValue(row),
    })),
  });

  return {
    content: `**${params.title}**`,
    image: { filename: "report-bar-chart.png", data },
  };
}

async function renderLineChart(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  const metric = params.result.plan.metrics[0];
  if (metric === undefined) {
    throw new Error("Cannot render report chart without at least one metric");
  }

  const data = await competitionChartToImage({
    chartType: "line",
    title: params.title,
    subtitle: reportSubtitle(params.result),
    yAxisLabel: metric,
    startDate: params.startedAt,
    endDate: params.startedAt,
    series: params.result.rows.map((row) => ({
      playerName: row.label,
      points: [{ date: params.startedAt, value: firstNumericValue(row) }],
    })),
  });

  return {
    content: `**${params.title}**`,
    image: { filename: "report-line-chart.png", data },
  };
}

function firstNumericValue(row: ReportResultRow): number {
  const value = row.values[0]?.value ?? 0;
  return typeof value === "number" ? value : 0;
}

function reportSubtitle(result: ReportQueryResult): string {
  return `${result.rows.length.toString()} row(s), ${result.rowsScanned.toString()} fact row(s) scanned`;
}
