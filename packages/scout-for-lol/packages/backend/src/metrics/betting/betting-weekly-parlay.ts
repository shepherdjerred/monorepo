import { Counter, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const bettingWeeklyParlayGenerationTotal = new Counter({
  name: "betting_weekly_parlay_generation_total",
  help: "Weekly Bryan Bucks generation attempts by terminal result.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingWeeklyParlayGenerationDurationSeconds = new Histogram({
  name: "betting_weekly_parlay_generation_duration_seconds",
  help: "Weekly Bryan Bucks generation duration for published markets.",
  buckets: [1, 2, 5, 10, 20, 40, 60, 90],
  registers: [registry],
});

export const bettingWeeklyParlayMarketsOpenedTotal = new Counter({
  name: "betting_weekly_parlay_markets_opened_total",
  help: "Weekly Bryan Bucks markets whose Discord publication became durable.",
  registers: [registry],
});

export const bettingWeeklyParlayMarketSettlementsTotal = new Counter({
  name: "betting_weekly_parlay_market_settlements_total",
  help: "Weekly Bryan Bucks markets reaching a terminal state.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingWeeklyParlayBetPlacementsTotal = new Counter({
  name: "betting_weekly_parlay_bet_placements_total",
  help: "Successful weekly Bryan Bucks position placements and top-ups.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingWeeklyParlayBetCancellationsTotal = new Counter({
  name: "betting_weekly_parlay_bet_cancellations_total",
  help: "Successful weekly Bryan Bucks position cancellations.",
  registers: [registry],
});

export const bettingWeeklyParlayBetSettlementsTotal = new Counter({
  name: "betting_weekly_parlay_bet_settlements_total",
  help: "Weekly Bryan Bucks positions reaching a terminal outcome.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingWeeklyParlayContributionsTotal = new Counter({
  name: "betting_weekly_parlay_contributions_total",
  help: "Idempotent eligible match contributions appended to weekly markets.",
  registers: [registry],
});

export const bettingWeeklyParlayControlActionsTotal = new Counter({
  name: "betting_weekly_parlay_control_actions_total",
  help: "Authenticated Temporal weekly-parlay actions by action and result.",
  labelNames: ["action", "result"] as const,
  registers: [registry],
});

export const bettingWeeklyParlayDeliveriesTotal = new Counter({
  name: "betting_weekly_parlay_deliveries_total",
  help: "Weekly Bryan Bucks Discord action deliveries by kind and result.",
  labelNames: ["kind", "result"] as const,
  registers: [registry],
});
