import * as Sentry from "@sentry/bun";
import {
  announcingSettlementSink,
  checkpointFailureIn,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";
import {
  BucksPoolRosterSchema,
  type BucksVoidReason,
  type RawMatch,
} from "@scout-for-lol/data";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { BucksStorageOverflowError } from "#src/betting/ledger.ts";
import {
  BucksCorruptIdentityError,
  reportCorruptBucksRow,
} from "#src/betting/settlement/corrupt-identity.ts";
import { settleOnePool } from "#src/betting/settlement/settle-one-pool.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";

import { closeBettingWindowsForMatch } from "#src/betting/settlement/sweep.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingPoolSettlementsTotal,
  bettingPoolVoidsTotal,
  bettingStakeBucksTotal,
} from "#src/metrics/betting/betting.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

const logger = createLogger("betting-settle");

async function settleWithOverflowFallback(input: {
  classificationVoid: BucksVoidReason | undefined;
  settle: (
    voidReason: BucksVoidReason | undefined,
  ) => Promise<SettlementSummary | undefined>;
}): Promise<SettlementSummary | undefined> {
  try {
    return await input.settle(input.classificationVoid);
  } catch (error) {
    if (
      input.classificationVoid !== undefined ||
      !(error instanceof BucksStorageOverflowError)
    ) {
      throw error;
    }
    // The attempted settlement rolled back. Claim the same pool again and
    // return only matched principal, which placement headroom guarantees
    // remains representable.
    return await input.settle("storage_overflow");
  }
}

export type BettingSettlementResult = {
  closures: ClosedPool[];
  settlements: SettlementSummary[];
};

/**
 * Match any still-open pools, then settle every guild pool at fixed even
 * money. Returning the close summaries matters when this call is retrying a
 * transiently failed post-match close: those users still need their final
 * matched and refunded receipt.
 */
export async function closeAndSettleBettingForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  sink: SettlementAnnouncementSink = announcingSettlementSink,
): Promise<BettingSettlementResult> {
  const matchId = matchData.metadata.matchId;
  const closures: ClosedPool[] = [];
  const summaries: SettlementSummary[] = [];

  try {
    // A very short game can resolve before the 30-second close sweep. Matching
    // must still happen before any outcome is read into settlement arithmetic.
    closures.push(
      ...(await closeBettingWindowsForMatch(
        matchId,
        prismaClient,
        new Date(),
        sink,
      )),
    );

    const pools = await prismaClient.bucksMatchPool.findMany({
      where: { matchId, poolState: "closed", matchedAt: { not: null } },
      select: { id: true, serverId: true, roster: true },
    });
    if (pools.length === 0) {
      return { closures, settlements: summaries };
    }

    const outcome = classifyMatchForBetting(matchData);
    const winningTeamId =
      outcome.kind === "decided" ? outcome.winningTeamId : undefined;
    const classificationVoid: BucksVoidReason | undefined =
      outcome.kind === "void" ? outcome.reason : undefined;

    for (const pool of pools) {
      const settle = async (voidReason: BucksVoidReason | undefined) =>
        await settleOnePool({
          prismaClient,
          poolId: pool.id,
          serverId: pool.serverId,
          matchId,
          roster: BucksPoolRosterSchema.parse(JSON.parse(pool.roster))
            .participants,
          winningTeamId,
          voidReason,
          sink,
        });
      try {
        const summary = await settleWithOverflowFallback({
          classificationVoid,
          settle,
        });
        if (summary !== undefined) {
          summaries.push(summary);
          recordSettlementObservations(summary, pool.id);
        }
      } catch (error) {
        // This handler exists for one guild's pool failing in isolation, and
        // it answers by logging and moving on. A checkpoint failure is not
        // that: the pool rolled back AND the settlement never became
        // recoverable, so absorbing it here lets the caller record a
        // settlement receipt over bettors who were never paid — which no
        // retry revisits, because the receipt says the effect is done.
        if (checkpointFailureIn(error) !== undefined) throw error;
        reportPoolSettlementFailure(error, pool, matchId);
      }
    }
  } catch (error) {
    // The same exemption, one level out: the per-pool rethrow above lands
    // here, and this handler's promise — that Bryan Bucks never blocks the
    // match cursor — must not extend to a settlement that failed to become
    // recoverable.
    if (checkpointFailureIn(error) !== undefined) throw error;
    logger.error(`❌ Could not settle Bryan Bucks for ${matchId}:`, error);
    Sentry.captureException(error, {
      tags: { source: "betting-settle", matchId },
    });
  }

  return { closures, settlements: summaries };
}

function reportPoolSettlementFailure(
  error: unknown,
  pool: { id: number; serverId: string },
  matchId: string,
): void {
  if (error instanceof BucksCorruptIdentityError) {
    // Deliberately not retried into the refund path: crediting a row whose
    // identity cannot be validated risks paying the wrong account. The pool
    // stays `closed` until an operator repairs the stored value, and every
    // postmatch retry re-raises this signal.
    reportCorruptBucksRow(logger, error, {
      source: "betting-settle-corrupt-row",
      matchId,
      poolId: pool.id,
      serverId: pool.serverId,
    });
    return;
  }
  logger.error(
    `❌ Could not settle Bryan Bucks pool ${pool.id.toString()} for ${matchId}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: {
      source: "betting-settle-pool",
      matchId,
      serverId: pool.serverId,
    },
    extra: { poolId: pool.id },
  });
}

/**
 * Count and log a settled pool.
 *
 * Called from the caller of `settleWithOverflowFallback`, never from inside
 * it: `settleOnePool` returns from within its `$transaction`, so an increment
 * there would survive a rollback.
 */
function recordSettlementObservations(
  summary: SettlementSummary,
  poolId: number,
): void {
  const voided = summary.voidReason !== undefined;
  bettingPoolSettlementsTotal.inc({ result: voided ? "voided" : "decided" });
  if (summary.voidReason !== undefined) {
    bettingPoolVoidsTotal.inc({ reason: summary.voidReason });
  }
  logBucksTransition({
    event: voided ? "bucks.pool.voided" : "bucks.pool.settled",
    matchId: summary.matchId,
    serverId: summary.serverId,
    poolId,
    fromState: "closed",
    toState: voided ? "voided" : "settled",
    houseCut: summary.houseCut,
    surface: "postmatch",
    ...(summary.winningTeamId === undefined
      ? {}
      : { teamId: summary.winningTeamId }),
    ...(summary.voidReason === undefined ? {} : { reason: summary.voidReason }),
  });
  for (const bet of summary.bets) {
    if (bet.isHouse) {
      continue;
    }
    bettingStakeBucksTotal.inc(
      { movement: bet.refunded ? "refunded_void" : "paid_out" },
      bet.payout,
    );
    if (bet.houseCut > 0) {
      bettingStakeBucksTotal.inc(
        { movement: "house_cut_settlement" },
        bet.houseCut,
      );
    }
    logBucksTransition({
      event: bet.refunded
        ? "bucks.bet.refunded"
        : bet.won
          ? "bucks.bet.won"
          : "bucks.bet.lost",
      matchId: summary.matchId,
      serverId: summary.serverId,
      poolId,
      betId: bet.betId,
      bucksAccountId: bet.bucksAccountId,
      actorDiscordId: bet.discordId,
      teamId: bet.predictedTeamId,
      matchedStake: bet.matchedStake,
      grossPayout: bet.grossPayout,
      houseCut: bet.houseCut,
      payout: bet.payout,
      surface: "postmatch",
    });
  }
}

/** Settle every guild pool for a finished match at fixed even money. */
export async function settleBettingForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<SettlementSummary[]> {
  const result = await closeAndSettleBettingForMatch(matchData, prismaClient);
  return result.settlements;
}
