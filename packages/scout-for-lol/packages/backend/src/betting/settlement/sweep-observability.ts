import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import {
  bettingBetsMatchedTotal,
  bettingHouseFillsTotal,
  bettingPoolsClosedTotal,
  bettingStakeBucksTotal,
} from "#src/metrics/betting.ts";

/**
 * Count and log a pool that just closed and matched.
 *
 * Lives outside `sweep.ts` because that file is already near the 500-line cap,
 * and is called from the *caller* of `matchPoolAtClose`: that function returns
 * from inside its `$transaction`, so an increment there would survive a
 * rollback.
 */
export function recordClosedPool(
  pool: ClosedPool,
  trigger: "window_expired" | "match_finished" | "stale_void",
): void {
  bettingPoolsClosedTotal.inc({ trigger });
  logBucksTransition({
    event: "bucks.pool.closed",
    matchId: pool.matchId,
    serverId: pool.serverId,
    fromState: "open",
    toState: "closed",
    matchedStake: pool.totalMatchedPerSide,
    surface: trigger === "match_finished" ? "postmatch" : "sweep",
  });

  if (pool.houseFill > 0) {
    const requested = pool.totalMatchedPerSide - pool.humanMatchedPerSide;
    bettingHouseFillsTotal.inc({
      result: pool.houseFill >= requested ? "full" : "partial",
    });
    bettingStakeBucksTotal.inc({ movement: "matched" }, pool.houseFill);
    logBucksTransition({
      event: "bucks.bet.house_filled",
      matchId: pool.matchId,
      serverId: pool.serverId,
      matchedStake: pool.houseFill,
      isHouse: true,
      surface: trigger === "match_finished" ? "postmatch" : "sweep",
    });
  } else {
    bettingHouseFillsTotal.inc({ result: "none" });
  }

  for (const position of pool.positions) {
    const result =
      position.matchedStake === 0
        ? "unmatched_refunded"
        : position.unmatchedStake === 0
          ? "fully_matched"
          : "partially_matched";
    bettingBetsMatchedTotal.inc({ result });
    if (position.matchedStake > 0) {
      bettingStakeBucksTotal.inc(
        { movement: "matched" },
        position.matchedStake,
      );
    }
    if (position.unmatchedStake > 0) {
      bettingStakeBucksTotal.inc(
        { movement: "refunded_unmatched" },
        position.unmatchedStake,
      );
    }
    logBucksTransition({
      event:
        position.matchedStake === 0
          ? "bucks.bet.unmatched_refunded"
          : "bucks.bet.matched",
      matchId: pool.matchId,
      serverId: pool.serverId,
      betId: position.betId,
      actorDiscordId: position.discordId,
      teamId: position.teamId,
      stake: position.submittedStake,
      matchedStake: position.matchedStake,
      unmatchedStake: position.unmatchedStake,
      surface: trigger === "match_finished" ? "postmatch" : "sweep",
    });
  }
}
