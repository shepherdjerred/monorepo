import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Bryan Bucks lifecycle and message-delivery metrics.
 *
 * Two rules govern every label here:
 *
 * 1. **Bounded label sets only.** Every label value comes from a closed
 *    TypeScript or Zod union. No `matchId`, `serverId`, `discordId`,
 *    `channelId`, or `puuid` — Bryan Bucks runs in exactly one guild, so a
 *    `server_id` label would carry zero information at the cost of a
 *    dimension.
 * 2. **Post-commit only.** Every increment fires *after* its `$transaction`
 *    resolves. A counter emitted inside a transaction that then rolls back is
 *    a lie that survives forever.
 *
 * Counters reset on pod restart and lose up to one scrape interval, so they
 * are a trend, never an audit trail. The permanent record is SQLite:
 * `BucksLedgerEntry` plus the pool and bet timestamp columns.
 */

/* --------------------------------------------------------------- pools -- */

export const bettingPoolsOpenedTotal = new Counter({
  name: "betting_pools_opened_total",
  help: "Bryan Bucks outcome pools opened, by queue.",
  labelNames: ["queue_type"] as const,
  registers: [registry],
});

export const bettingPoolOpenFailuresTotal = new Counter({
  name: "betting_pool_open_failures_total",
  help: "Bryan Bucks outcome pools that could not be opened.",
  registers: [registry],
});

export const bettingPoolsClosedTotal = new Counter({
  name: "betting_pools_closed_total",
  help: "Bryan Bucks outcome pools closed and matched, by what triggered it.",
  labelNames: ["trigger"] as const,
  registers: [registry],
});

export const bettingPoolSettlementsTotal = new Counter({
  name: "betting_pool_settlements_total",
  help: "Bryan Bucks outcome pools reaching a terminal state.",
  labelNames: ["result"] as const,
  registers: [registry],
});

/**
 * Deliberately overlaps `betting_pool_settlements_total{result="voided"}`: that
 * one is the state-machine count, this one is the reason breakdown. Do not
 * "fix" the duplication. Note the parlay twin `betting_parlay_voids_total`
 * already exists and must not be reused for outcome pools.
 */
export const bettingPoolVoidsTotal = new Counter({
  name: "betting_pool_voids_total",
  help: "Bryan Bucks outcome pools voided, by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const bettingSettlementConservationFailuresTotal = new Counter({
  name: "betting_settlement_conservation_failures_total",
  help: "Bryan Bucks conservation assertions that failed before throwing.",
  labelNames: ["stage"] as const,
  registers: [registry],
});

/* ---------------------------------------------------------------- bets -- */

export const bettingBetPlacementsTotal = new Counter({
  name: "betting_bet_placements_total",
  help: "Bryan Bucks outcome bet placements by surface and result.",
  labelNames: ["surface", "result"] as const,
  registers: [registry],
});

export const bettingBetCancellationsTotal = new Counter({
  name: "betting_bet_cancellations_total",
  help: "Bryan Bucks outcome bet cancellations by surface and result.",
  labelNames: ["surface", "result"] as const,
  registers: [registry],
});

export const bettingBetsMatchedTotal = new Counter({
  name: "betting_bets_matched_total",
  help: "Bryan Bucks outcome positions by how much of them matched at close.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingHouseFillsTotal = new Counter({
  name: "betting_house_fills_total",
  help: "How completely the house filled a one-sided Bryan Bucks market.",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const bettingStakeBucksTotal = new Counter({
  name: "betting_stake_bucks_total",
  help: "Bryan Bucks moved through the outcome market, by movement kind.",
  labelNames: ["movement"] as const,
  registers: [registry],
});

/* ------------------------------------------------------------ earnings -- */

export const bettingEarningsAwardedTotal = new Counter({
  name: "betting_earnings_awarded_total",
  help: "Bryan Bucks earning awards, by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const bettingEarningsBucksTotal = new Counter({
  name: "betting_earnings_bucks_total",
  help: "Bryan Bucks awarded as earnings, by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/* --------------------------------------------------------- peek passes -- */

export const bettingPeekPassesTotal = new Counter({
  name: "betting_peek_passes_total",
  help: "Bryan Bucks peek-pass purchase attempts, by result.",
  labelNames: ["result"] as const,
  registers: [registry],
});

/* --------------------------------------------------- message delivery -- */

export const bettingMessageOperationsTotal = new Counter({
  name: "betting_message_operations_total",
  help: "Bryan Bucks Discord sends and edits, by surface and outcome.",
  labelNames: ["surface", "operation", "result"] as const,
  registers: [registry],
});

export const bettingMessageOperationDurationSeconds = new Histogram({
  name: "betting_message_operation_duration_seconds",
  help: "Bryan Bucks Discord send and edit latency.",
  labelNames: ["surface", "operation"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const bettingMessageRefsRecordedTotal = new Counter({
  name: "betting_message_refs_recorded_total",
  help: "Whether a pool's prematch message references became durable.",
  labelNames: ["status"] as const,
  registers: [registry],
});

/**
 * A settlement that was paid but cannot be announced.
 *
 * `no_refs_owed` is the alarming one: somebody was owed something and will
 * never be told, and the pool has committed as settled so there is no retry.
 */
export const bettingSettlementUndeliverableTotal = new Counter({
  name: "betting_settlement_undeliverable_total",
  help: "Bryan Bucks settlements with no destination, by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

/* ------------------------------------------------------ reconciliation -- */

export const bettingReconciliationRunsTotal = new Counter({
  name: "betting_reconciliation_runs_total",
  help: "Bryan Bucks reconciliation runs, by outcome.",
  labelNames: ["status"] as const,
  registers: [registry],
});

/**
 * The CURRENT run's finding counts, reset each run.
 *
 * A gauge rather than only a counter because a nightly job's `increase()`
 * alert is noisy; this answers "is the ledger drifting right now" directly.
 */
export const bettingReconciliationFindings = new Gauge({
  name: "betting_reconciliation_findings",
  help: "Bryan Bucks reconciliation findings from the most recent run.",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const bettingReconciliationLastRunTimestampSeconds = new Gauge({
  name: "betting_reconciliation_last_run_timestamp_seconds",
  help: "When Bryan Bucks reconciliation last completed.",
  registers: [registry],
});

/* --------------------------------------------------------- DB-swept -- */

export const bettingPoolsByState = new Gauge({
  name: "betting_pools_by_state",
  help: "Bryan Bucks outcome pools currently in each state.",
  labelNames: ["state"] as const,
  registers: [registry],
});

/**
 * Age of the oldest pool that has not reached a terminal state.
 *
 * Past `VOID_GRACE_MS` this means `voidStaleBettingPools` itself is not
 * running, which is the one failure that silently destroys staked Bucks.
 */
export const bettingOldestUnresolvedPoolAgeSeconds = new Gauge({
  name: "betting_oldest_unresolved_pool_age_seconds",
  help: "Age of the oldest unresolved Bryan Bucks pool.",
  registers: [registry],
});

export const bettingPendingStakeBucks = new Gauge({
  name: "betting_pending_stake_bucks",
  help: "Bryan Bucks currently at risk in pending positions.",
  registers: [registry],
});

export const bettingHouseBalanceBucks = new Gauge({
  name: "betting_house_balance_bucks",
  help: "Current Bryan Bucks house balance.",
  registers: [registry],
});
