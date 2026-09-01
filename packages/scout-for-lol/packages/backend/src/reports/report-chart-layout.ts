import type { ReportRenderSpec } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { AnalyticsChartProps } from "@scout-for-lol/report";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-types.ts";
import { chartNumber } from "#src/reports/report-chart-values.ts";

export type ReportChartRender = Extract<
  ReportRenderSpec,
  { encoding: unknown }
>;

export type AnalyticsChartBase = Pick<
  AnalyticsChartProps,
  "title" | "subtitle" | "theme" | "palette" | "colors" | "legend" | "labels"
>;

export function chartBase(
  render: ReportChartRender,
  title: string,
): AnalyticsChartBase {
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

export function yColumns(
  result: ReportQueryResult,
  render: ReportChartRender,
): string[] {
  const configured = render.encoding.y;
  if (Array.isArray(configured)) return configured;
  if (configured !== undefined) return [configured];
  const first = result.plan.outputs[0]?.name;
  if (first === undefined) {
    throw new Error("Cannot render a chart without an output column.");
  }
  return [first];
}

export function requireFirst(columns: string[]): string {
  const first = columns[0];
  if (first === undefined) {
    throw new Error("Chart requires at least one Y column.");
  }
  return first;
}

export function chartRows(
  plan: ScoutQlPlan,
  rows: ReportResultRow[],
  render: ReportChartRender,
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
