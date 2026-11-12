import { Counter, Gauge, Histogram } from "prom-client";
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
  // Riot ID) and "error" (the lookup failed; the durable attempt retries it
  // with backoff), plus the durable-attempt outcomes "queued" (a non-observer
  // UUID was enqueued for the drain), "no_riot_id" (the client reported no
  // Riot ID, so it can't be looked up), "retry_scheduled" (a failed lookup got
  // a later attempt), "riot_match" (an alias was learned from a game Riot also
  // published, at no API cost) and "riot_match_ambiguous" (the mapping was
  // refused because two participants shared a team and champion)
  labelNames: ["outcome"] as const,
  registers: [registry],
});

/**
 * Games a paired Scout Client watched start, and how many of them Scout never
 * got a prematch for, over the sweep's lookback window. `game_kind` is the
 * shared classifier's queue type, or `unknown`; a failed sweep publishes -1
 * under `sweep_failed`.
 *
 * This decides whether the client needs to supply prematch itself: Riot's
 * Spectator API gives Scout its prematch today, and a client-built one is
 * only worth having for games Spectator misses. Both gauges read -1 when the
 * sweep fails.
 */
export const scoutClientObservedGames = new Gauge({
  name: "scout_client_observed_games",
  help: "Games a Scout Client observed in progress, over the lookback window",
  labelNames: ["game_kind"] as const,
  registers: [registry],
});

export const scoutClientGamesWithoutPrematch = new Gauge({
  name: "scout_client_games_without_prematch",
  help: "Games a Scout Client observed in progress that Scout archived no prematch for",
  labelNames: ["game_kind"] as const,
  registers: [registry],
});

/**
 * Terminal outcomes of recovering client post-game observations. Only
 * `unsupported_mode` (Arena, whose results come from Riot) is counted so far;
 * a general outcome metric belongs to the client metrics work.
 */
export const scoutClientProjectionOutcomesTotal = new Counter({
  name: "scout_client_projection_outcomes_total",
  help: "Terminal outcomes of recovering Scout Client post-game observations",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

/**
 * Observations the server received, by kind and what became of them. `kind` is
 * the protocol's closed observation-kind set and `quarantine_reason` its closed
 * reason set (`none` for an accepted observation), so every label is bounded;
 * no device, player or match identifier is ever a label.
 *
 * Counted once, when the observation is first stored, so a client retrying its
 * outbox does not inflate it. A rising `quarantined` share is the first sign a
 * rollout is dropping client evidence.
 */
export const scoutClientObservationsTotal = new Counter({
  name: "scout_client_observations_total",
  help: "Scout Client observations first stored, by kind, outcome and quarantine reason",
  labelNames: ["kind", "outcome", "quarantine_reason"] as const,
  registers: [registry],
});

/**
 * What became of each Scout Client post-game observation: the typed outcome
 * projection's closed set (`ScoutClientPostGameOutcome`), and the shared
 * classifier's queue type of the game, or `unknown`.
 */
export const scoutClientPostGameOutcomeTotal = new Counter({
  name: "scout_client_post_game_outcome_total",
  help: "Scout Client post-game observations by projected outcome and game kind",
  labelNames: ["outcome", "game_kind"] as const,
  registers: [registry],
});

/**
 * Seconds from a game ending to its post-match report being delivered to
 * Discord. Buckets span the two-minute Riot-first grace through a delayed
 * client outbox.
 */
export const scoutClientGameEndToDeliveredSeconds = new Histogram({
  name: "scout_client_game_end_to_delivered_seconds",
  help: "Seconds from game end to the post-match report being delivered to Discord",
  buckets: [30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200],
  registers: [registry],
});

/**
 * Matches Riot's history listed after a client selection was already made for
 * them. Each is a match two sources both claim: the duplicate-risk signal.
 */
export const scoutClientRiotListedAfterSelectionTotal = new Counter({
  name: "scout_client_riot_listed_after_selection_total",
  help: "Matches Riot listed after a Scout Client selection had already been made",
  registers: [registry],
});

/**
 * League-client UUIDs reported in the last day that still have no Riot alias:
 * the identities whose lookups have not (or not yet) succeeded. The lookups'
 * own failures are `scout_client_identity_aliases_total` by outcome. Reads -1
 * when the sweep fails.
 */
export const scoutClientAliasLookupBacklog = new Gauge({
  name: "scout_client_alias_lookup_backlog",
  help: "Distinct League-client UUIDs seen in the last day with no Riot alias",
  registers: [registry],
});

/** Devices that checked in over the last fifteen minutes; -1 when the sweep fails. */
export const scoutClientActiveDevices = new Gauge({
  name: "scout_client_active_devices",
  help: "Scout Client devices seen in the last fifteen minutes",
  registers: [registry],
});

/**
 * Accepted post-game and Clash observations whose evidence has not finished
 * reconciling, and the age in seconds of the oldest. Both read -1 when the
 * sweep fails.
 */
export const scoutClientReconciliationBacklog = new Gauge({
  name: "scout_client_reconciliation_backlog",
  help: "Accepted Scout Client observations awaiting evidence reconciliation",
  registers: [registry],
});

export const scoutClientReconciliationOldestAgeSeconds = new Gauge({
  name: "scout_client_reconciliation_oldest_age_seconds",
  help: "Age in seconds of the oldest accepted observation awaiting reconciliation",
  registers: [registry],
});
