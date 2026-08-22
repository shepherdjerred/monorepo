import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingHouseBalanceBucks,
  bettingOldestUnresolvedPoolAgeSeconds,
  bettingPendingStakeBucks,
  bettingPoolsByState,
} from "#src/metrics/betting.ts";

const logger = createLogger("metrics-betting-sweep");

const POOL_STATES = ["open", "closed", "settled", "voided"] as const;

/**
 * Refresh the Bryan Bucks gauges from the database.
 *
 * Called from `getMetrics()` so the values are current at scrape time, the
 * same pattern `updateUsageMetrics` uses. Wrapped so a metrics query can never
 * fail the `/metrics` response.
 */
export async function updateBettingMetrics(
  prismaClient?: ExtendedPrismaClient,
): Promise<void> {
  try {
    const databaseModule = await import("../database/index.js");
    const prisma = prismaClient ?? databaseModule.prisma;

    const [byState, oldestUnresolved, pendingStake, houseAccounts] =
      await Promise.all([
        prisma.bucksMatchPool.groupBy({
          by: ["poolState"],
          _count: { _all: true },
        }),
        prisma.bucksMatchPool.findFirst({
          where: { poolState: { in: ["open", "closed"] } },
          orderBy: { closesAt: "asc" },
          select: { closesAt: true },
        }),
        prisma.bucksBet.findMany({
          where: { betOutcome: "pending" },
          select: { stake: true, matchedStake: true },
        }),
        prisma.bucksAccount.findMany({
          where: { isHouse: true },
          select: { balance: true },
        }),
      ]);

    const counts = new Map(
      byState.map((row) => [row.poolState, row._count._all]),
    );
    for (const state of POOL_STATES) {
      bettingPoolsByState.set({ state }, counts.get(state) ?? 0);
    }

    bettingOldestUnresolvedPoolAgeSeconds.set(
      oldestUnresolved === null
        ? 0
        : Math.max(
            0,
            Math.floor(
              (Date.now() - oldestUnresolved.closesAt.getTime()) / 1000,
            ),
          ),
    );

    bettingPendingStakeBucks.set(
      pendingStake.reduce(
        (total, bet) => total + (bet.matchedStake ?? bet.stake),
        0,
      ),
    );

    bettingHouseBalanceBucks.set(
      houseAccounts.reduce((total, account) => total + account.balance, 0),
    );
  } catch (error) {
    logger.error("❌ Error updating Bryan Bucks metrics:", error);
    // Deliberately not rethrown: a metrics query must never fail /metrics.
  }
}
