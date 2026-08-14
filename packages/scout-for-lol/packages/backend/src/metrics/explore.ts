import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const scoutExploreTurnsTotal = new Counter({
  name: "scout_explore_turns_total",
  help: "Total explore conversation turns by status.",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const scoutExploreTurnDurationSeconds = new Histogram({
  name: "scout_explore_turn_duration_seconds",
  help: "Duration of explore conversation turns in seconds.",
  labelNames: ["status"] as const,
  buckets: [1, 2, 5, 10, 30, 60, 120, 180],
  registers: [registry],
});

export const scoutExploreToolCallsTotal = new Counter({
  name: "scout_explore_tool_calls_total",
  help: "Total explore agent tool calls by tool name and status.",
  labelNames: ["tool_name", "status"] as const,
  registers: [registry],
});

export const scoutExploreTokensUsedTotal = new Counter({
  name: "scout_explore_tokens_used_total",
  help: "Total explore agent tokens used by model and token kind.",
  labelNames: ["model", "kind"] as const,
  registers: [registry],
});

export const scoutExploreActiveRuns = new Gauge({
  name: "scout_explore_active_runs",
  help: "Current number of active explore turns.",
  registers: [registry],
});

export const scoutExploreSharesTotal = new Counter({
  name: "scout_explore_shares_total",
  help: "Explore conversation share-link actions by action.",
  labelNames: ["action"] as const,
  registers: [registry],
});
