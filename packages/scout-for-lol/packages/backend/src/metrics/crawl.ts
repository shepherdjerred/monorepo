import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Participant-crawl metrics. Labels are closed vocabularies only: never a
 * PUUID, match id, route-of-player or other unbounded value.
 */

/** Matches the crawl stored, by whether a reduced timeline was sampled. */
export const crawlMatchesCrawledTotal = new Counter({
  name: "scout_crawl_matches_crawled_total",
  help: "Matches the participant crawl stored in raw segments",
  labelNames: ["timeline"] as const,
  registers: [registry],
});

/** Frontier rows by crawl depth (0 = seeded from a tracked match). */
export const crawlFrontierSize = new Gauge({
  name: "scout_crawl_frontier_size",
  help: "Players in the participant-crawl frontier by depth",
  labelNames: ["depth"] as const,
  registers: [registry],
});

/**
 * Crawl requests the budget refused, by reason: a Riot ledger reason
 * (`retry-after`, `probe-in-flight`, `app-window`, `method-window`) or
 * `daily-match-budget` when the day's match budget is spent. In `observe`
 * mode a ledger refusal is recorded though the request is still sent.
 */
export const crawlBudgetRefusalsTotal = new Counter({
  name: "scout_crawl_budget_refusals_total",
  help: "Participant-crawl budget refusals by reason",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/** Riot 429 responses received by a crawl-class request. */
export const crawlRiot429Total = new Counter({
  name: "scout_crawl_riot_429_total",
  help: "Riot 429 responses received by the participant crawl",
  labelNames: ["limit_type"] as const,
  registers: [registry],
});

/** The crawl utilisation target in force, after clamping; set every tick. */
export const crawlUtilisationTargetRatio = new Gauge({
  name: "scout_crawl_utilisation_target_ratio",
  help: "Participant-crawl Riot utilisation target in force (clamped)",
  registers: [registry],
});

/** Matches the latest tick was allowed: remaining daily budget over remaining ticks. */
export const crawlTickMatchAllowance = new Gauge({
  name: "scout_crawl_tick_match_allowance",
  help: "Matches the latest participant-crawl tick was allowed by daily pacing",
  registers: [registry],
});

/** Crawl ticks by how they ended. */
export const crawlTicksTotal = new Counter({
  name: "scout_crawl_ticks_total",
  help: "Participant-crawl ticks by outcome",
  labelNames: ["status"] as const,
  registers: [registry],
});
