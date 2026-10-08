import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * League-client player identities resolved to Riot API PUUIDs.
 *
 * Every Scout Client payload names players by League-client UUID, and nothing
 * the server knows can be compared with one until it is aliased, so a rising
 * `error` or `not_found` count means client data silently stops joining.
 */
export const scoutClientIdentityAliasesTotal = new Counter({
  name: "scout_client_identity_aliases_total",
  help: "League-client UUIDs resolved to Riot API PUUIDs",
  // Outcome values: "learned" (a new alias was stored), "corrected" (the
  // player's own client replaced an alias someone else's had taught),
  // "conflict" (a different PUUID resolved for a UUID that already has one;
  // the stored one stands), "not_found" (Riot has no account for the reported
  // Riot ID) and "error" (the lookup failed; a later observation retries it)
  labelNames: ["outcome"] as const,
  registers: [registry],
});

/**
 * Games a paired Scout Client watched start, and how many of them Scout never
 * got a prematch for, over the sweep's lookback window. `custom` splits
 * customs from matchmade games.
 *
 * This decides whether the client needs to supply prematch itself: Riot's
 * Spectator API gives Scout its prematch today, and a client-built one is
 * only worth having for games Spectator misses. Both gauges read -1 when the
 * sweep fails.
 */
export const scoutClientObservedGames = new Gauge({
  name: "scout_client_observed_games",
  help: "Games a Scout Client observed in progress, over the lookback window",
  labelNames: ["custom"] as const,
  registers: [registry],
});

export const scoutClientGamesWithoutPrematch = new Gauge({
  name: "scout_client_games_without_prematch",
  help: "Games a Scout Client observed in progress that Scout archived no prematch for",
  labelNames: ["custom"] as const,
  registers: [registry],
});
