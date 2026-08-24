import type { RawMatch } from "@scout-for-lol/data";
import { awardBucksForMatch, type EarnedAward } from "#src/betting/earnings.ts";
import {
  closeAndSettleBettingForMatch,
  type SettlementSummary,
} from "#src/betting/settle.ts";
import {
  settleParlaysForMatch,
  type ParlaySettlementSummary,
} from "#src/betting/parlay-settle.ts";
import { refreshClosedParlayMessages } from "#src/betting/parlay-refresh.ts";
import { refreshClosedBucksMessages } from "#src/betting/message-refresh.ts";
import { closeBettingWindowsForMatch } from "#src/betting/sweep.ts";
import type { ClosedPool } from "#src/betting/sweep-types.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { captureWeeklyParlayContributions } from "#src/betting/weekly-parlay-contribution.ts";

export async function refreshSettledPoolMessages(
  straightPools: readonly { matchId: string; serverId: string }[],
  parlaySettlements: readonly ParlaySettlementSummary[],
  refreshStraightPools: typeof refreshClosedBucksMessages = refreshClosedBucksMessages,
  disableParlayPools: typeof refreshClosedParlayMessages = refreshClosedParlayMessages,
): Promise<void> {
  const uniqueStraightPools = new Map<
    string,
    { matchId: string; serverId: string }
  >();
  for (const pool of straightPools) {
    uniqueStraightPools.set(`${pool.serverId}:${pool.matchId}`, pool);
  }
  await refreshStraightPools([...uniqueStraightPools.values()]);
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
export async function settleAndAwardBucks(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<{
  closures: ClosedPool[];
  settlements: SettlementSummary[];
  parlaySettlements: ParlaySettlementSummary[];
  earnings: EarnedAward[];
}> {
  if (isFeatureHardDisabled("betting_enabled")) {
    return {
      closures: [],
      settlements: [],
      parlaySettlements: [],
      earnings: [],
    };
  }
  const closures = await closeBettingWindowsForMatch(
    matchData.metadata.matchId,
    prismaClient,
  );
  const retry = await closeAndSettleBettingForMatch(matchData, prismaClient);
  closures.push(...retry.closures);
  const parlaySettlements = await settleParlaysForMatch(
    matchData,
    prismaClient,
  );
  // The canonical match has already been persisted by the caller. Weekly
  // progress is append-only and may settle only an irreversible YES here;
  // Sunday finalization remains the only path to an early-false result.
  await captureWeeklyParlayContributions(matchData, prismaClient);
  const earnings = await awardBucksForMatch(matchData, prismaClient);
  // Discord cleanup runs after the committed local operations and regardless
  // of whether the caller suppresses an old match's post-match notification.
  // This also covers a remake or very short game that settles an `open` market
  // before the ordinary five-minute close sweep can remove its controls.
  await refreshSettledPoolMessages(
    [...closures, ...retry.settlements],
    parlaySettlements,
    async (pools) => {
      await refreshClosedBucksMessages(pools, prismaClient);
    },
  );
  return {
    closures,
    settlements: retry.settlements,
    parlaySettlements,
    earnings,
  };
}
