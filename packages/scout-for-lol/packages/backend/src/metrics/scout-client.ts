import { Counter } from "prom-client";
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
