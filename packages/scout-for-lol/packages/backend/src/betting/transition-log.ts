import { createLogger } from "#src/logger.ts";
import { captureBucksLifecycle } from "#src/analytics/bryan-bucks.ts";

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
export type BucksTransitionEvent = Parameters<
  typeof captureBucksLifecycle
>[0]["transition"];

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
  recipientDiscordId?: string;
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
  fee?: number;
  balanceAfter?: number;
  reason?: string;
  surface?:
    "button" | "command" | "web" | "sweep" | "postmatch" | "cron" | "prematch";
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
    captureBucksLifecycle({
      serverId: fields.serverId,
      transition: fields.event,
      amountBucks: fields.stake,
      matchedBucks: fields.matchedStake,
      payoutBucks: fields.payout,
      balanceAfterBucks: fields.balanceAfter,
    });
  } catch {
    // Intentionally empty: a failed log must not abort a settlement.
  }
}
