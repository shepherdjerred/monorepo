import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/** Frontier rows the pruner deleted, by rule: `stale` or `overflow`. */
export const crawlFrontierPrunedTotal = new Counter({
  name: "scout_crawl_frontier_pruned_total",
  help: "Participant-crawl frontier rows deleted by the pruner",
  labelNames: ["reason"] as const,
  registers: [registry],
});
