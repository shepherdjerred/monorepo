import type { ReportOutputFormat, ReportRenderSpec } from "@scout-for-lol/data";
import { competitionChartToImage } from "@scout-for-lol/report";
import {
  ReportMetricSchema,
  type ReportMetric,
} from "#src/reports/query-language.ts";
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
  result: ReportQueryResult;
  startedAt: Date;
};

type ChartRender = Extract<
  ReportRenderSpec,
  { kind: "BAR_CHART" | "LINE_CHART" }
>;

// The display is fully described by the query's parsed RENDER clause
// (`result.plan.render`); there is no separate stored output format.
export async function renderReportOutput(
  params: RenderReportOutputParams,
): Promise<RenderedReportOutput> {
  const render = params.result.plan.render;
  if (render.kind === "BAR_CHART") {
    return await renderBarChart(params, render);
  }
  if (render.kind === "LINE_CHART") {
    return await renderLineChart(params, render);
  }
  return {
    content: formatTextReport(params.title, render.kind, params.result),
    image: null,
  };
}

function formatTextReport(
  title: string,
  kind: ReportOutputFormat,
  result: ReportQueryResult,
): string {
  if (result.rows.length === 0) {
    return `**${title}**\nNo rows matched this report.`;
  }

  if (kind === "TABLE") {
    return `**${title}**\n${formatTable(result)}`;
  }

  if (kind === "LIST") {
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

type ResolvedChart = {
  title: string;
  yAxisLabel: string;
  values: { label: string; value: number }[];
};

/**
 * Resolve the declarative chart encoding into concrete plot inputs. The Y
 * channel selects which SELECTed metric is plotted (default: the first metric,
 * matching the pre-DSL behavior); title/axis fall back to the report title and
 * the metric name. The X channel is the row dimension (`label`).
 */
function resolveChart(
  params: RenderReportOutputParams,
  render: ChartRender,
): ResolvedChart {
  const metrics = params.result.plan.metrics;
  const firstMetric = metrics[0];
  if (firstMetric === undefined) {
    throw new Error("Cannot render report chart without at least one metric");
  }
  // The Y channel is a free string in the spec but the parser already validated
  // it against the SELECTed metrics; re-parse to recover the ReportMetric type.
  const yColumn = render.encoding.y;
  const yMetric: ReportMetric =
    yColumn === undefined ? firstMetric : ReportMetricSchema.parse(yColumn);
  const yIndex = Math.max(0, metrics.indexOf(yMetric));
  return {
    title: render.options.title ?? params.title,
    yAxisLabel: render.options.yAxisLabel ?? yMetric,
    values: params.result.rows.map((row) => ({
      label: row.label,
      value: numericValue(row, yIndex),
    })),
  };
}

async function renderBarChart(
  params: RenderReportOutputParams,
  render: Extract<ReportRenderSpec, { kind: "BAR_CHART" }>,
): Promise<RenderedReportOutput> {
  const chart = resolveChart(params, render);
  const data = await competitionChartToImage({
    chartType: "bar",
    title: chart.title,
    subtitle: reportSubtitle(params.result),
    yAxisLabel: chart.yAxisLabel,
    bars: chart.values.map((entry) => ({
      playerName: entry.label,
      value: entry.value,
    })),
  });

  return {
    content: `**${chart.title}**`,
    image: { filename: "report-bar-chart.png", data },
  };
}

async function renderLineChart(
  params: RenderReportOutputParams,
  render: Extract<ReportRenderSpec, { kind: "LINE_CHART" }>,
): Promise<RenderedReportOutput> {
  const chart = resolveChart(params, render);
  const data = await competitionChartToImage({
    chartType: "line",
    title: chart.title,
    subtitle: reportSubtitle(params.result),
    yAxisLabel: chart.yAxisLabel,
    startDate: params.startedAt,
    endDate: params.startedAt,
    series: chart.values.map((entry) => ({
      playerName: entry.label,
      points: [{ date: params.startedAt, value: entry.value }],
    })),
  });

  return {
    content: `**${chart.title}**`,
    image: { filename: "report-line-chart.png", data },
  };
}

function numericValue(row: ReportResultRow, index: number): number {
  const value = row.values[index]?.value ?? 0;
  return typeof value === "number" ? value : 0;
}

function reportSubtitle(result: ReportQueryResult): string {
  return `${result.rows.length.toString()} row(s), ${result.rowsScanned.toString()} fact row(s) scanned`;
}
