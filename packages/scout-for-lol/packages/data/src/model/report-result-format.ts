import type { ReportQueryPlan } from "#src/model/report-query-spec.ts";
import type {
  ReportResultColumn,
  ReportValueFormat,
} from "#src/model/report.ts";
import { reportColumnLabel } from "#src/model/report-query-registry.ts";
import { REPORT_METRICS } from "#src/model/report-query-metrics.ts";

export function reportResultColumns(
  plan: ReportQueryPlan,
  columns: string[],
): ReportResultColumn[] {
  return columns.map((column) => ({
    key: column,
    label: reportColumnLabel(column, plan.groupBy),
    format: reportValueFormat(column),
  }));
}

export function formatReportDisplayValue(
  column: ReportResultColumn,
  value: string | number,
): string {
  if (typeof value === "string") {
    return value;
  }
  if (column.format === "percent") {
    return `${(value * 100).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  }
  if (column.format === "integer") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function reportValueFormat(column: string): ReportValueFormat {
  if (column === "label" || column === "rank") {
    return "text";
  }
  const metric = REPORT_METRICS.find((entry) => entry.id === column);
  if (metric?.kind === "rate") {
    return "percent";
  }
  if (metric?.kind === "count") {
    return "integer";
  }
  return "decimal";
}
