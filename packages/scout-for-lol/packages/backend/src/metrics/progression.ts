import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const hallBaselineDuration = new Histogram({
  name: "scout_hall_baseline_duration_seconds",
  help: "Hall of Fame baseline duration by outcome",
  labelNames: ["status"] as const,
  buckets: [1, 5, 15, 30, 60, 300, 900, 3600],
  registers: [registry],
});

export const hallRecordBreakDeliveries = new Counter({
  name: "scout_hall_record_break_deliveries_total",
  help: "Hall of Fame record-break delivery outcomes",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const challengeRecomputeDuration = new Histogram({
  name: "scout_challenge_recompute_duration_seconds",
  help: "Challenge run recomputation duration by outcome",
  labelNames: ["status"] as const,
  buckets: [1, 5, 15, 30, 60, 300, 900, 3600],
  registers: [registry],
});

export const challengeMissingTimelineMatches = new Counter({
  name: "scout_challenge_missing_timeline_matches_total",
  help: "Matches reported without timeline evidence in completed challenge revisions",
  registers: [registry],
});

export const challengeRunCompletions = new Counter({
  name: "scout_challenge_run_completions_total",
  help: "Challenge runs completed by deterministic evidence evaluation",
  registers: [registry],
});

export const challengeRecomputeLag = new Gauge({
  name: "scout_challenge_recompute_lag_seconds",
  help: "Age of the oldest queued or running challenge revision",
  registers: [registry],
});

export const duelSeriesState = new Gauge({
  name: "scout_duel_series_state",
  help: "Current duel-series rows by lifecycle state",
  labelNames: ["state"] as const,
  registers: [registry],
});

export const duelSeriesTransitions = new Counter({
  name: "scout_duel_series_transitions_total",
  help: "Duel-series lifecycle transitions",
  labelNames: ["from", "to"] as const,
  registers: [registry],
});

export const duelSeriesOverdue = new Counter({
  name: "scout_duel_series_overdue_total",
  help: "Duel series whose durable deadline expired",
  registers: [registry],
});

export const duelResults = new Counter({
  name: "scout_duel_results_total",
  help: "Duel result evaluation outcomes",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const duelTournamentProvisioning = new Counter({
  name: "scout_duel_tournament_provisioning_total",
  help: "Duel Tournament API provisioning outcomes",
  labelNames: ["status"] as const,
  registers: [registry],
});
