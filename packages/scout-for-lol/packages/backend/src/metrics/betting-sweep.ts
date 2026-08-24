import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { captureBucksEconomySnapshot } from "#src/analytics/bryan-bucks.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingHouseBalanceBucks,
  bettingOldestUnresolvedPoolAgeSeconds,
  bettingPendingStakeBucks,
  bettingPoolsByState,
} from "#src/metrics/betting.ts";

const logger = createLogger("metrics-betting-sweep");

const POOL_STATES = ["open", "closed", "settled", "voided"] as const;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const lastSnapshotAtByServer = new Map<string, number>();

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
    const databaseModule = await import("#src/database/index.ts");
    const prisma = prismaClient ?? databaseModule.prisma;

    const [
      byState,
      oldestUnresolved,
      pendingStake,
      pendingParlayStake,
      pendingWeeklyStake,
      houseAccounts,
      memberAccounts,
    ] = await Promise.all([
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
      prisma.bucksParlayBet.aggregate({
        where: { betOutcome: "pending" },
        _sum: { stake: true },
      }),
      prisma.bucksWeeklyParlayBet.aggregate({
        where: { betOutcome: "pending" },
        _sum: { stake: true },
      }),
      prisma.bucksAccount.findMany({
        where: { isHouse: true },
        select: { serverId: true, balance: true },
      }),
      prisma.bucksAccount.findMany({
        where: { isHouse: false },
        select: { serverId: true, balance: true },
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

    const pendingStakeBucks =
      pendingStake.reduce(
        (total, bet) => total + (bet.matchedStake ?? bet.stake),
        0,
      ) +
      (pendingParlayStake._sum.stake ?? 0) +
      (pendingWeeklyStake._sum.stake ?? 0);
    bettingPendingStakeBucks.set(pendingStakeBucks);

    bettingHouseBalanceBucks.set(
      houseAccounts.reduce((total, account) => total + account.balance, 0),
    );

    const now = Date.now();
    const serverIds = new Set([
      ...houseAccounts.map((account) => account.serverId),
      ...memberAccounts.map((account) => account.serverId),
    ]);
    for (const serverId of serverIds) {
      const lastSnapshotAt = lastSnapshotAtByServer.get(serverId) ?? 0;
      if (now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) continue;

      const serverHouseBalance = houseAccounts
        .filter((account) => account.serverId === serverId)
        .reduce((total, account) => total + account.balance, 0);
      const serverMembers = memberAccounts.filter(
        (account) => account.serverId === serverId,
      );
      captureBucksEconomySnapshot({
        serverId,
        memberAccounts: serverMembers.length,
        totalMemberBalanceBucks: serverMembers.reduce(
          (total, account) => total + account.balance,
          0,
        ),
        pendingStakeBucks,
        houseBalanceBucks: serverHouseBalance,
        openMarkets: (counts.get("open") ?? 0) + (counts.get("closed") ?? 0),
      });
      lastSnapshotAtByServer.set(serverId, now);
    }
  } catch (error) {
    logger.error("❌ Error updating Bryan Bucks metrics:", error);
    // Deliberately not rethrown: a metrics query must never fail /metrics.
  }
}
