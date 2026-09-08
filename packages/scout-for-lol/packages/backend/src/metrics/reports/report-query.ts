import { Counter, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Every ScoutQL report-query execution, labeled by plan source and outcome.
 * Recorded at the single choke point `executeReportQuery`, so it covers the
 * live preview path (previously uninstrumented), manual runs, and scheduled
 * runs alike — complementing the `scheduled_report_*` run metrics, which only
 * see the run/scheduled paths.
 */
export const scoutReportQueryRunsTotal = new Counter({
  name: "scout_report_query_runs_total",
  help: "Total ScoutQL report-query executions by plan source and outcome.",
  labelNames: ["source", "outcome"] as const,
  registers: [registry],
});

export const scoutReportQueryDurationSeconds = new Histogram({
  name: "scout_report_query_duration_seconds",
  help: "Duration of ScoutQL report-query executions in seconds, by plan source and outcome.",
  labelNames: ["source", "outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});
