import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/index.ts";

export const scheduledReportsDueTotal = new Counter({
  name: "scheduled_reports_due_total",
  help: "Total scheduled reports found due by the dispatcher.",
  registers: [registry],
});

export const scheduledReportsActive = new Gauge({
  name: "scheduled_reports_active",
  help: "Current number of enabled scheduled reports.",
  registers: [registry],
});

export const scheduledReportRunsTotal = new Counter({
  name: "scheduled_report_runs_total",
  help: "Total generic report runs by status, trigger, output format, and source.",
  labelNames: ["status", "trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

// Keep the plural `scheduled_reports_*` families as dashboard-facing aliases
// while existing singular `scheduled_report_*` consumers migrate.
export const scheduledReportsRunTotal = new Counter({
  name: "scheduled_reports_run_total",
  help: "Total generic report runs by status, trigger, output format, and source.",
  labelNames: ["status", "trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportsFailedTotal = new Counter({
  name: "scheduled_reports_failed_total",
  help: "Total failed generic report runs by trigger, output format, and source.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportRunDurationSeconds = new Histogram({
  name: "scheduled_report_run_duration_seconds",
  help: "Generic report run duration in seconds.",
  labelNames: ["status", "trigger", "output_format", "system_source"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const scheduledReportsDurationMs = new Histogram({
  name: "scheduled_reports_duration_ms",
  help: "Generic report run duration in milliseconds.",
  labelNames: ["status", "trigger", "output_format", "system_source"] as const,
  buckets: [100, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000],
  registers: [registry],
});

export const scheduledReportRowsScannedTotal = new Counter({
  name: "scheduled_report_rows_scanned_total",
  help: "Total SQLite fact rows scanned by generic report runs.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportsRowsScannedTotal = new Counter({
  name: "scheduled_reports_rows_scanned_total",
  help: "Total SQLite fact rows scanned by generic report runs.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportRowsReturnedTotal = new Counter({
  name: "scheduled_report_rows_returned_total",
  help: "Total result rows returned by generic report runs.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportsRowsReturnedTotal = new Counter({
  name: "scheduled_reports_rows_returned_total",
  help: "Total result rows returned by generic report runs.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});

export const scheduledReportRowsTotal = new Counter({
  name: "scheduled_report_rows_total",
  help: "Total result rows returned by generic report runs.",
  labelNames: ["trigger", "output_format", "system_source"] as const,
  registers: [registry],
});
