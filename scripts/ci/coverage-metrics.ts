import type {
  CoverageMetric,
  CoverageMetricName,
  CoverageMetrics,
} from "./coverage-reporting.ts";

const metricNames = [
  "lines",
  "statements",
  "functions",
  "branches",
] satisfies readonly CoverageMetricName[];

export function sumCoverageMetrics(
  summaries: readonly CoverageMetrics[],
): CoverageMetrics {
  const result: CoverageMetrics = {};
  const unavailableMetrics = new Set(
    summaries.flatMap((summary) => summary.unavailableMetrics ?? []),
  );
  for (const metric of metricNames) {
    if (unavailableMetrics.has(metric)) {
      continue;
    }
    const values: CoverageMetric[] = [];
    for (const summary of summaries) {
      const value = summary[metric];
      if (value !== undefined) {
        values.push(value);
      }
    }
    if (values.length > 0) {
      result[metric] = {
        covered: values.reduce((total, value) => total + value.covered, 0),
        total: values.reduce((total, value) => total + value.total, 0),
      };
    }
  }
  if (unavailableMetrics.size > 0) {
    result.unavailableMetrics = metricNames.filter((metric) =>
      unavailableMetrics.has(metric),
    );
  }
  return result;
}
