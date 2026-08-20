import type { RawMatch } from "@scout-for-lol/data";
import { awardBucksForMatch, type EarnedAward } from "#src/betting/earnings.ts";
import {
  settleBettingForMatch,
  type SettlementSummary,
} from "#src/betting/settle.ts";
import {
  settleParlaysForMatch,
  type ParlaySettlementSummary,
} from "#src/betting/parlay-settle.ts";
import { disableClosedBettingMessages } from "#src/betting/message-controls.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";

export async function refreshSettledPoolMessages(
  settlements: readonly SettlementSummary[],
  parlaySettlements: readonly ParlaySettlementSummary[],
  refreshStraightPools: typeof refreshClosedBucksMessages = refreshClosedBucksMessages,
  disableParlayPools: typeof disableClosedBettingMessages = disableClosedBettingMessages,
): Promise<void> {
  await refreshStraightPools(settlements);
  await disableParlayPools(parlaySettlements);
}

/**
 * The one call the post-match poller makes into Bryan Bucks.
 *
 * Each operation swallows its own errors, so this never throws and never
 * blocks the match-history cursor from advancing.
 *
 * Order matters: settlement reads `betOutcome: "pending"` bets and earning
 * writes only ledger rows, so they do not contend — but settling first means a
 * an outcome or parlay settlement failure cannot be masked by an earning
 * failure in the logs.
 */
export async function settleAndAwardBucks(matchData: RawMatch): Promise<{
  settlements: SettlementSummary[];
  parlaySettlements: ParlaySettlementSummary[];
  earnings: EarnedAward[];
}> {
  const settlements = await settleBettingForMatch(matchData);
  const parlaySettlements = await settleParlaysForMatch(matchData);
  const earnings = await awardBucksForMatch(matchData);
  // Discord cleanup runs after the committed local operations and regardless
  // of whether the caller suppresses an old match's post-match notification.
  // This also covers a remake or very short game that settles an `open` market
  // before the ordinary five-minute close sweep can remove its controls.
  await refreshSettledPoolMessages(settlements, parlaySettlements);
  return { settlements, parlaySettlements, earnings };
}
