import * as Sentry from "@sentry/bun";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-sweep");

/**
 * The two background passes that keep pools from getting stuck.
 *
 * Neither is load-bearing for correctness at bet time — closure is enforced
 * against `closesAt` inside `placeBet`'s transaction — but without the second
 * one, staked Bucks from a match that never produces a post-match result would
 * be silently destroyed.
 *
 * Neither is gated on `betting_enabled`, for the same reason settlement is not:
 * the flag governs taking Bucks, not returning them. A guild removed from the
 * allowlist must still get its outstanding stakes refunded.
 */

export type ClosedPool = {
  matchId: string;
  serverId: string;
};

/**
 * Move every expired open pool to `closed`.
 *
 * Purely so the state is queryable and the buttons can be greyed out; a bet
 * arriving between expiry and this sweep is already refused by `placeBet`.
 *
 * @returns the pools that this pass closed, with the messages whose components
 * should now be disabled
 */
export async function closeExpiredBettingWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<ClosedPool[]> {
  try {
    const expired = await prismaClient.bucksMatchPool.findMany({
      where: { poolState: "open", closesAt: { lt: now } },
      select: { id: true, matchId: true, serverId: true },
    });
    if (expired.length === 0) {
      return [];
    }

    const closed: ClosedPool[] = [];
    for (const pool of expired) {
      // Guarded so two overlapping sweeps cannot both report the same pool and
      // edit its messages twice.
      const claim = await prismaClient.bucksMatchPool.updateMany({
        where: { id: pool.id, poolState: "open" },
        data: { poolState: "closed" },
      });
      if (claim.count !== 1) {
        continue;
      }
      closed.push({
        matchId: pool.matchId,
        serverId: pool.serverId,
      });
    }

    if (closed.length > 0) {
      logger.info(
        `🔒 Closed ${closed.length.toString()} Bryan Bucks betting window(s)`,
      );
    }
    return closed;
  } catch (error) {
    logger.error("❌ Could not close expired Bryan Bucks windows:", error);
    Sentry.captureException(error, { tags: { source: "betting-sweep-close" } });
    return [];
  }
}

/**
 * Refund every pool that is long past its window and still unsettled.
 *
 * The grace period is six hours, chosen against two existing constants rather
 * than picked round: `ActiveGame`'s TTL and `MAX_DISCORD_ALERT_AGE_MS` are both
 * three hours, so by the time this fires the match can no longer arrive through
 * the normal post-match path at all.
 *
 * The trade is deliberate and stated: a match whose settlement kept throwing
 * ends in a refund rather than a wrong payout. Without this pass those stakes
 * would simply vanish.
 *
 * @returns how many pools were voided
 */
export async function voidStaleBettingPools(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - VOID_GRACE_MS);
  let voided = 0;

  try {
    const stale = await prismaClient.bucksMatchPool.findMany({
      where: {
        poolState: { in: ["open", "closed"] },
        closesAt: { lt: cutoff },
      },
      select: { id: true, matchId: true },
    });

    for (const pool of stale) {
      const refunded = await refundPool(prismaClient, pool.id, pool.matchId);
      if (refunded) {
        voided += 1;
      }
    }

    if (voided > 0) {
      logger.info(
        `↩️ Voided ${voided.toString()} stale Bryan Bucks pool(s) and refunded every stake`,
      );
    }
  } catch (error) {
    logger.error("❌ Could not void stale Bryan Bucks pools:", error);
    Sentry.captureException(error, { tags: { source: "betting-sweep-void" } });
  }

  return voided;
}

async function refundPool(
  prismaClient: ExtendedPrismaClient,
  poolId: number,
  matchId: string,
): Promise<boolean> {
  return await prismaClient.$transaction(async (tx) => {
    // Claim first: this both proves no settlement beat us to it and takes the
    // write lock for the refunds below.
    const claim = await tx.bucksMatchPool.updateMany({
      where: { id: poolId, poolState: { in: ["open", "closed"] } },
      data: {
        poolState: "voided",
        voidReason: "expired",
        settledAt: new Date(),
      },
    });
    if (claim.count !== 1) {
      return false;
    }

    const bets = await tx.bucksBet.findMany({
      where: { poolId, betOutcome: "pending" },
      select: {
        id: true,
        bucksAccountId: true,
        stake: true,
        predictedTeamId: true,
        subjectPuuid: true,
      },
      orderBy: { id: "asc" },
    });

    for (const bet of bets) {
      await tx.bucksBet.update({
        where: { id: bet.id },
        data: {
          betOutcome: "refunded",
          payout: bet.stake,
          settledAt: new Date(),
        },
      });
      await applyBucksDelta(tx, {
        bucksAccountId: bet.bucksAccountId,
        delta: bet.stake,
        kind: "bet_refund",
        matchId,
        betId: bet.id,
        predictedTeamId: bet.predictedTeamId,
        context: {
          type: "settlement",
          subjectAlias: "a tracked player",
          backedAliases: [],
          opposingAliases: [],
          winnersPool: 0,
          losersPool: 0,
          stakeReturned: bet.stake,
          winnings: 0,
          voidReason: "expired",
        },
      });
    }

    return true;
  });
}
