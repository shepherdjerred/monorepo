import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-transition");

/**
 * The canonical Bryan Bucks state-transition log.
 *
 * Convention: a stable event name as the message, plus exactly one flat object
 * bag as the second argument. The rest of `src/betting/` interpolates into the
 * message, which only a human can read; these lines exist to be queried.
 *
 * **Retention.** Loki holds 90 days of stdout. These lines are a rolling
 * quarter, not history — the permanent record is SQLite (`BucksLedgerEntry`
 * plus the pool and bet timestamp columns). Do not treat this as the audit
 * trail.
 *
 * **Caveat.** stdout is tslog `pretty`, so the bag is embedded in the line
 * rather than being the line. `{app="scout"} |= "bucks.pool.settled"` works
 * today; a clean `| json` needs a regex extraction, or a JSON stdout transport
 * that would change every log line in the service.
 *
 * Discord IDs are fine here. The prohibition in AGENTS.md is scoped to PostHog
 * captures and browser distinct ids, because a distinct id is a durable
 * cross-product join key; existing code already logs channel and guild IDs and
 * puts them in Sentry tags. `subjectPuuid` is deliberately omitted: `teamId` is
 * what the wager *is*, and the PUUID is a Riot identifier that adds nothing.
 *
 * **Every call must be post-commit.** A transition logged inside a transaction
 * that then rolls back is a lie that survives for 90 days.
 */
export type BucksTransitionEvent =
  | "bucks.pool.opened"
  | "bucks.pool.closed"
  | "bucks.pool.settled"
  | "bucks.pool.voided"
  | "bucks.bet.placed"
  | "bucks.bet.topped_up"
  | "bucks.bet.rejected"
  | "bucks.bet.cancelled"
  | "bucks.bet.matched"
  | "bucks.bet.unmatched_refunded"
  | "bucks.bet.house_filled"
  | "bucks.bet.won"
  | "bucks.bet.lost"
  | "bucks.bet.refunded"
  | "bucks.parlay.published"
  | "bucks.parlay.opened"
  | "bucks.parlay.closed"
  | "bucks.parlay.settled"
  | "bucks.parlay.voided"
  | "bucks.parlay_bet.placed"
  | "bucks.parlay_bet.cancelled"
  | "bucks.parlay_bet.settled"
  | "bucks.weekly_parlay.published"
  | "bucks.weekly_parlay.opened"
  | "bucks.weekly_parlay.started"
  | "bucks.weekly_parlay.settled"
  | "bucks.weekly_parlay.voided"
  | "bucks.weekly_parlay_bet.placed"
  | "bucks.weekly_parlay_bet.topped_up"
  | "bucks.weekly_parlay_bet.cancelled"
  | "bucks.weekly_parlay_bet.settled"
  | "bucks.weekly_parlay.contribution_recorded"
  | "bucks.earning.awarded"
  | "bucks.peek_pass.purchased";

export type BucksTransitionFields = {
  event: BucksTransitionEvent;
  matchId?: string;
  serverId?: string;
  poolId?: number;
  marketId?: number;
  betId?: number;
  parlayBetId?: number;
  definitionId?: number;
  periodKey?: string;
  slot?: number;
  bucksAccountId?: number;
  actorDiscordId?: string;
  fromState?: string;
  toState?: string;
  teamId?: number;
  side?: "YES" | "NO";
  stake?: number;
  matchedStake?: number;
  unmatchedStake?: number;
  grossPayout?: number;
  houseCut?: number;
  payout?: number;
  balanceAfter?: number;
  reason?: string;
  surface?: "button" | "command" | "sweep" | "postmatch" | "cron" | "prematch";
  queueType?: string;
  isHouse?: boolean;
  contributionCount?: number;
};

export function logBucksTransition(fields: BucksTransitionFields): void {
  // Observability must never fail product behaviour. This is the one place in
  // the transition path that can throw, so it is the one place that catches.
  try {
    // Absent optional fields are simply not enumerable, and
    // `exactOptionalPropertyTypes` stops a caller passing an explicit
    // `undefined`, so the bag is already minimal for Loki.
    logger.info(fields.event, fields);
  } catch {
    // Intentionally empty: a failed log must not abort a settlement.
  }
}
