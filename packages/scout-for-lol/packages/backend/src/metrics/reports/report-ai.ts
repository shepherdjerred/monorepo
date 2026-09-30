import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const scoutReportAiRunsTotal = new Counter({
  name: "scout_report_ai_runs_total",
  help: "Total report AI edit runs by status.",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const scoutReportAiRunDurationSeconds = new Histogram({
  name: "scout_report_ai_run_duration_seconds",
  help: "Duration of report AI edit runs in seconds.",
  labelNames: ["status"] as const,
  buckets: [1, 2, 5, 10, 30, 60, 120, 180],
  registers: [registry],
});

export const scoutReportAiToolCallsTotal = new Counter({
  name: "scout_report_ai_tool_calls_total",
  help: "Total report AI tool calls by tool name and status.",
  labelNames: ["tool_name", "status"] as const,
  registers: [registry],
});

export const scoutReportAiTokensUsedTotal = new Counter({
  name: "scout_report_ai_tokens_used_total",
  help: "Total report AI tokens used by model and token kind.",
  labelNames: ["model", "kind"] as const,
  registers: [registry],
});

export const scoutReportAiActiveRuns = new Gauge({
  name: "scout_report_ai_active_runs",
  help: "Current number of active report AI edit runs.",
  registers: [registry],
});
