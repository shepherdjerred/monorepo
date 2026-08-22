import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const bettingParlayGenerationTotal = new Counter({
  name: "betting_parlay_generation_total",
  help: "Bryan Bucks parlay generation attempts by bounded outcome.",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const bettingParlayGenerationDurationSeconds = new Histogram({
  name: "betting_parlay_generation_duration_seconds",
  help: "End-to-end Bryan Bucks parlay generation duration.",
  labelNames: ["status"] as const,
  buckets: [1, 5, 10, 20, 30, 45, 60],
  registers: [registry],
});

export const bettingParlayTokensTotal = new Counter({
  name: "betting_parlay_tokens_total",
  help: "Tokens used generating Bryan Bucks parlays.",
  labelNames: ["model", "kind"] as const,
  registers: [registry],
});

export const bettingParlayVoidsTotal = new Counter({
  name: "betting_parlay_voids_total",
  help: "Bryan Bucks parlay markets voided by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/* -------------------------------------------------- market lifecycle -- */

export const bettingParlayMarketsPublishedTotal = new Counter({
  name: "betting_parlay_markets_published_total",
  help: "Bryan Bucks parlay markets persisted behind a preparation message.",
  registers: [registry],
});

export const bettingParlayMarketsOpenedTotal = new Counter({
  name: "betting_parlay_markets_opened_total",
  help: "Bryan Bucks parlay markets activated from publishing to open.",
  registers: [registry],
});

export const bettingParlayMarketsClosedTotal = new Counter({
  name: "betting_parlay_markets_closed_total",
  help: "Bryan Bucks parlay markets closed at their betting window.",
  registers: [registry],
});

export const bettingParlayMarketSettlementsTotal = new Counter({
  name: "betting_parlay_market_settlements_total",
  help: "Bryan Bucks parlay markets reaching a terminal state.",
  labelNames: ["result"] as const,
  registers: [registry],
});

/* ------------------------------------------------------------ bets ---- */

export const bettingParlayBetPlacementsTotal = new Counter({
  name: "betting_parlay_bet_placements_total",
  help: "Bryan Bucks parlay bet placements by surface and result.",
  labelNames: ["surface", "result"] as const,
  registers: [registry],
});

export const bettingParlayBetCancellationsTotal = new Counter({
  name: "betting_parlay_bet_cancellations_total",
  help: "Bryan Bucks parlay bet cancellations by surface and result.",
  labelNames: ["surface", "result"] as const,
  registers: [registry],
});

export const bettingParlayBetSettlementsTotal = new Counter({
  name: "betting_parlay_bet_settlements_total",
  help: "Bryan Bucks parlay bets reaching a terminal outcome.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingParlayHouseUnavailableTotal = new Counter({
  name: "betting_parlay_house_unavailable_total",
  help: "Parlay placements rejected because the house could not reserve liability.",
  registers: [registry],
});

export const bettingOversizedStakeRejectedTotal = new Counter({
  name: "betting_oversized_stake_rejected_total",
  help: "Outcome or parlay stake operations rejected at the Int32 boundary.",
  labelNames: ["market"] as const,
  registers: [registry],
});

export const bettingParlayHouseBalance = new Gauge({
  name: "betting_parlay_house_balance",
  help: "Current house balance observed during parlay placement.",
  registers: [registry],
});
