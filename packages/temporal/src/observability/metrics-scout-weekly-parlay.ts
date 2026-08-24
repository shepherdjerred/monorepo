import { Counter, Histogram } from "prom-client";
import { register } from "./metrics.ts";

export const scoutWeeklyParlayActionsTotal = new Counter({
  name: "scout_weekly_parlay_actions_total",
  help: "Scout weekly parlay control activity calls by action and bounded result",
  labelNames: ["action", "result"] as const,
  registers: [register],
});

export const scoutWeeklyParlayActionDurationSeconds = new Histogram({
  name: "scout_weekly_parlay_action_duration_seconds",
  help: "Wall-clock duration of Scout weekly parlay control activity calls",
  labelNames: ["action", "result"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20],
  registers: [register],
});
