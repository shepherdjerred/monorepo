import type { RawMatch } from "@scout-for-lol/data";
import { awardBucksForMatch, type EarnedAward } from "#src/betting/earnings.ts";
import {
  settleBettingForMatch,
  type SettlementSummary,
} from "#src/betting/settle.ts";

/**
 * The one call the post-match poller makes into Bryan Bucks.
 *
 * Both halves swallow their own errors, so this never throws and never blocks
 * the match-history cursor from advancing.
 *
 * Order matters: settlement reads `betOutcome: "pending"` bets and earning
 * writes only ledger rows, so they do not contend — but settling first means a
 * settlement failure cannot be masked by an earning failure in the logs.
 */
export async function settleAndAwardBucks(matchData: RawMatch): Promise<{
  settlements: SettlementSummary[];
  earnings: EarnedAward[];
}> {
  const settlements = await settleBettingForMatch(matchData);
  const earnings = await awardBucksForMatch(matchData);
  return { settlements, earnings };
}
