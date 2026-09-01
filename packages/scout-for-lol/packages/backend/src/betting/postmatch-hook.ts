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
import { settleDaresForMatch } from "#src/betting/dare-settle.ts";
import {
  DarePartialSettlementError,
  type DareSettlementSummary,
} from "#src/betting/dare-settle-shared.ts";
import { deliverDareSummaries } from "#src/betting/dare-delivery.ts";
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
 * Every operation except dares swallows its own errors, so this never
 * throws for their sake and never blocks the match-history cursor from
 * advancing on their account. Dares are the deliberate exception — see the
 * comment at that call site and `settleDaresForMatch`'s doc comment for why
 * a dare capture failure, after its own short bounded retry, propagates out
 * of this function instead of being swallowed.
 *
 * Order matters: settlement reads `betOutcome: "pending"` bets and earning
 * writes only ledger rows, so they do not contend — but settling first means a
 * an outcome or parlay settlement failure cannot be masked by an earning
 * failure in the logs. Dares run last for a different reason — see the
 * comment at that call site.
 */
export async function settleAndAwardBucks(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<{
  closures: ClosedPool[];
  settlements: SettlementSummary[];
  parlaySettlements: ParlaySettlementSummary[];
  dareSettlements: DareSettlementSummary[];
  earnings: EarnedAward[];
}> {
  if (isFeatureHardDisabled("betting_enabled")) {
    return {
      closures: [],
      settlements: [],
      parlaySettlements: [],
      dareSettlements: [],
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
  // Dares run LAST, and unlike everything above, settleDaresForMatch CAN
  // throw (after its own short bounded retry exhausts — see its doc
  // comment). Everything above it (parlay settlement, weekly capture,
  // earnings) already committed its own idempotent, state-gated writes, so
  // a throw here — and the caller not advancing the cursor — simply retries
  // the whole match later; those writes safely no-op on replay. Running
  // dares last also means an ordinary (non-retry-exhausting) throw anywhere
  // ABOVE this line can never discard an already-committed dare summary
  // before it reaches delivery: a dare's summary is one-shot the same way an
  // outcome settlement's is (see AGENTS.md's "settlement summary is
  // one-shot" note), and computing it earlier would risk losing that return
  // value to a later throw, leaving an already-terminal dare with no
  // summary to announce, ever.
  let dareSettlements: DareSettlementSummary[];
  try {
    dareSettlements = await settleDaresForMatch(matchData, prismaClient);
  } catch (error) {
    if (error instanceof DarePartialSettlementError) {
      // Deliver what DID commit before propagating: those summaries are
      // one-shot and cannot be reproduced on a retry (see
      // settleDaresForMatch's doc comment). The retry that follows this
      // throw only needs to re-attempt whichever dare actually failed.
      await deliverDareSummaries(error.summaries, prismaClient);
    }
    throw error;
  }
  return {
    closures,
    settlements: retry.settlements,
    parlaySettlements,
    dareSettlements,
    earnings,
  };
}
