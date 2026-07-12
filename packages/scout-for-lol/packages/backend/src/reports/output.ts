import {
  ReportMetricSchema,
  formatReportDisplayValue,
  reportResultColumns,
  type ReportMetric,
  type ReportOutputFormat,
  type ReportRenderSpec,
} from "@scout-for-lol/data";
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
      .map((row) => `- ${row.label}: ${formatValues(result, row)}`)
      .join("\n")}`;
  }

  return `**${title}**\n${result.rows
    .map(
      (row, index) =>
        `${(index + 1).toString()}. ${row.label} — ${formatValues(result, row)}`,
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
          return value === undefined
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
      return `${column.label}: ${formatReportDisplayValue(column, value.value)}`;
    })
    .join(", ");
}

type ResolvedChart = {
  title: string;
  yAxisLabel: string;
  valueSuffix: string;
  values: { label: string; value: number }[];
};

/**
 * Resolve the declarative chart encoding into concrete plot inputs. The Y
 * channel selects which SELECTed metric is plotted (default: the first metric,
 * matching the pre-DSL behavior); the axis label and value formatting come from
 * the metric's display metadata (overridable via the `y_axis` option). The X
 * channel is the row dimension (`label`).
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
  // The parser already validated `y` against the SELECTed metrics, so the
  // column must be present here. Fail fast on the "cannot happen" state rather
  // than silently defaulting to index 0 (the first metric) and plotting the
  // wrong series.
  const yIndex = metrics.indexOf(yMetric);
  if (yIndex === -1) {
    throw new Error(
      `RENDER y = "${yMetric}" is not among the SELECTed metrics [${metrics.join(
        ", ",
      )}]`,
    );
  }
  const display = reportResultColumns(params.result.plan, [yMetric])[0];
  if (display === undefined) {
    throw new Error(`Missing report display metadata for ${yMetric}`);
  }
  const percent = display.format === "percent";
  return {
    title: render.options.title ?? params.title,
    yAxisLabel: render.options.yAxisLabel ?? display.label,
    valueSuffix: percent ? "%" : "",
    values: params.result.rows.map((row) => ({
      label: row.label,
      value: percent
        ? Math.round(numericValue(row, yIndex) * 100)
        : numericValue(row, yIndex),
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
    yAxisLabel: chart.yAxisLabel,
    valueSuffix: chart.valueSuffix,
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
    yAxisLabel: chart.yAxisLabel,
    valueSuffix: chart.valueSuffix,
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
