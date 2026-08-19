import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const scoutBucksAskRunsTotal = new Counter({
  name: "scout_bucks_ask_runs_total",
  help: "Total Bryan Bucks analysis runs by status.",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const scoutBucksAskDurationSeconds = new Histogram({
  name: "scout_bucks_ask_duration_seconds",
  help: "Duration of Bryan Bucks analysis runs in seconds.",
  labelNames: ["status"] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [registry],
});

export const scoutBucksAskToolCallsTotal = new Counter({
  name: "scout_bucks_ask_tool_calls_total",
  help: "Total Bryan Bucks analysis tool calls by tool and status.",
  labelNames: ["tool_name", "status"] as const,
  registers: [registry],
});

export const scoutBucksAskTokensUsedTotal = new Counter({
  name: "scout_bucks_ask_tokens_used_total",
  help: "Total Bryan Bucks analysis tokens by model and token kind.",
  labelNames: ["model", "kind"] as const,
  registers: [registry],
});

export const scoutBucksAskActiveRuns = new Gauge({
  name: "scout_bucks_ask_active_runs",
  help: "Current number of active Bryan Bucks analysis runs.",
  registers: [registry],
});
