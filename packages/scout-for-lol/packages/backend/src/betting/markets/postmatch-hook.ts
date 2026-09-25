import * as Sentry from "@sentry/bun";
import type { RawMatch } from "@scout-for-lol/data";
import {
  awardBucksForMatch,
  type EarnedAward,
} from "#src/betting/accounts/earnings.ts";
import { closeAndSettleBettingForMatch } from "#src/betting/settle.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import { settleParlaysForMatch } from "#src/betting/parlays/runtime/parlay-settle.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import { settleDaresForMatch } from "#src/betting/dares/settlement/dare-settle.ts";
import { settleDaresV2ForMatch } from "#src/betting/dares/settlement/dare-settle-v2.ts";
import { DareV2PartialSettlementError } from "#src/betting/dares/settlement/dare-settle-types-v2.ts";
import type { DareTimelineEvidenceV2 } from "#src/betting/dares/evaluation/dare-evaluator-v2.ts";
import {
  defaultDareV2CalloutDependencies,
  refreshPendingDareV2Callouts,
  type DareV2CalloutDependencies,
} from "#src/betting/dares/presentation/dare-callout-v2.ts";
import { DarePartialSettlementError } from "#src/betting/dares/settlement/dare-settle-shared.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import { refreshClosedParlayMessages } from "#src/betting/parlays/runtime/parlay-refresh.ts";
import { refreshClosedBucksMessages } from "#src/betting/notify/message-refresh.ts";
import { closeBettingWindowsForMatch } from "#src/betting/settlement/sweep.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { createLogger } from "#src/logger.ts";
import {
  announcingSettlementSink,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";

const logger = createLogger("betting-postmatch-hook");

export async function refreshPendingDareV2CalloutsWithoutBlocking(
  dependencies: DareV2CalloutDependencies,
  refresh: typeof refreshPendingDareV2Callouts = refreshPendingDareV2Callouts,
): Promise<void> {
  try {
    await refresh(dependencies);
  } catch (error) {
    logger.error("Could not refresh pending Dare v2 callouts:", error);
    Sentry.captureException(error, {
      tags: { source: "betting-postmatch-dare-v2-delivery" },
    });
  }
}

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
  options: {
    dareTimeline?: DareTimelineEvidenceV2 | undefined;
    /**
     * Who may announce what this settlement produces. Defaults to v1's own
     * behaviour, so a caller that says nothing announces everything exactly as
     * it did before the sink existed.
     */
    announcementSink?: SettlementAnnouncementSink | undefined;
  } = {},
): Promise<{
  closures: ClosedPool[];
  settlements: SettlementSummary[];
  parlaySettlements: ParlaySettlementSummary[];
  dareSettlements: DareSettlementSummary[];
  earnings: EarnedAward[];
}> {
  const sink = options.announcementSink ?? announcingSettlementSink;
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
    new Date(),
    sink,
  );
  const retry = await closeAndSettleBettingForMatch(
    matchData,
    prismaClient,
    sink,
  );
  closures.push(...retry.closures);
  const parlaySettlements = await settleParlaysForMatch(
    matchData,
    prismaClient,
    sink,
  );
  const earnings = await awardBucksForMatch(matchData, prismaClient, sink);
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
  // comment). Everything above it (parlay settlement, earnings) already
  // committed its own idempotent, state-gated writes, so
  // a throw here — and the caller not advancing the cursor — simply retries
  // the whole match later; those writes safely no-op on replay. Running
  // dares last also means an ordinary (non-retry-exhausting) throw anywhere
  // ABOVE this line can never discard an already-committed dare summary
  // before it reaches delivery: a dare's summary is one-shot the same way an
  // outcome settlement's is: `settleDaresForMatch` returns summaries only for
  // the transition that committed them, and computing it earlier would risk losing that return
  // value to a later throw, leaving an already-terminal dare with no
  // summary to announce, ever.
  // V2 capture is also unflagged: any funded contract keeps evaluating after
  // rollout revocation. Run it before v1 so a v2 failure cannot discard a
  // one-shot v1 settlement summary that already committed.
  try {
    await settleDaresV2ForMatch(matchData, prismaClient, {
      timeline: options.dareTimeline,
      // Whether the ROW may exist, not merely whether this run drains it:
      // the v1 poller drains the same outbox with no sink, so a delivery
      // withheld from one drain is sent by the next.
      notify: sink.mayEnqueueDareNotification() ? "enqueue" : "withhold",
    });
  } catch (error) {
    if (error instanceof DareV2PartialSettlementError) {
      await refreshPendingDareV2CalloutsWithoutBlocking({
        ...defaultDareV2CalloutDependencies,
        prismaClient,
        mayPost: sink.mayPostDareCallout,
      });
    }
    throw error;
  }
  await refreshPendingDareV2CalloutsWithoutBlocking({
    ...defaultDareV2CalloutDependencies,
    prismaClient,
    mayPost: sink.mayPostDareCallout,
  });
  await sink.drainDareNotifications(prismaClient);
  let dareSettlements: DareSettlementSummary[];
  try {
    dareSettlements = await settleDaresForMatch(
      matchData,
      prismaClient,
      new Date(),
      sink,
    );
  } catch (error) {
    if (error instanceof DarePartialSettlementError) {
      // Deliver what DID commit before propagating: those summaries are
      // one-shot and cannot be reproduced on a retry (see
      // settleDaresForMatch's doc comment). The retry that follows this
      // throw only needs to re-attempt whichever dare actually failed.
      await sink.deliverPartialDareSummaries(error.summaries, prismaClient);
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
