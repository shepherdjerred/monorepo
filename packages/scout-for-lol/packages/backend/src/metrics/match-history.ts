import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Player match-history checks that ended without an answer from Riot.
 *
 * Unavailability is an expected boundary outcome (outage, timeout, 404, or a
 * response that failed validation). The Riot call itself already records and
 * reports real HTTP failures, so this counts the polling consequence: the
 * player stays unchecked and is retried by the next poll. `dare_required`
 * separates the checks that also hold back an active Dare's collection.
 */
export const scoutMatchHistoryUnavailableTotal = new Counter({
  name: "scout_match_history_unavailable_total",
  help: "Player match-history checks that ended without an answer from Riot",
  labelNames: ["dare_required"] as const,
  registers: [registry],
});
