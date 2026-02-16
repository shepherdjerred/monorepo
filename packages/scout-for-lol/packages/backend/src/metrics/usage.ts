/**
 * Usage metrics collection and update logic
 */

import {
  playersTrackedTotal,
  accountsTrackedTotal,
  competitionsActiveTotal,
  competitionsTotalCreated,
  subscriptionsTotal,
  serversWithDataTotal,
  accountsByRegion,
  competitionParticipantsTotal,
  avgPlayersPerServer,
  avgAccountsPerPlayer,
} from "@scout-for-lol/backend/metrics/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("metrics-usage");

/**
 * Update usage metrics from database
 * This function queries the database to get current counts and updates the gauges
 */
export async function updateUsageMetrics(): Promise<void> {
  try {
    // Import prisma client here to avoid circular dependencies
    const { prisma } = await import("../database/index.js");

    // Get total counts
    const [playersCount, accountsCount, activeCompetitionsCount, totalCompetitionsCount, subscriptionsCount] =
      await Promise.all([
        prisma.player.count(),
        prisma.account.count(),
        prisma.competition.count({ where: { isCancelled: false } }),
        prisma.competition.count(),
        prisma.subscription.count(),
      ]);

    // Update basic counts
    playersTrackedTotal.set(playersCount);
    accountsTrackedTotal.set(accountsCount);
    competitionsActiveTotal.set(activeCompetitionsCount);
    competitionsTotalCreated.set(totalCompetitionsCount);
    subscriptionsTotal.set(subscriptionsCount);

    // Get unique servers with data
    const serversWithData = await prisma.player.findMany({
      select: { serverId: true },
      distinct: ["serverId"],
    });
    serversWithDataTotal.set(serversWithData.length);

    // Get accounts by region
    const accountsByRegionData = await prisma.account.groupBy({
      by: ["region"],
      _count: true,
    });

    // Reset all region labels first (in case a region was removed)
    accountsByRegion.reset();

    // Set counts for each region
    for (const { region, _count } of accountsByRegionData) {
      accountsByRegion.set({ region }, _count);
    }

    // Get competition participants by status
    const participantsByStatus = await prisma.competitionParticipant.groupBy({
      by: ["status"],
      _count: true,
    });

    // Reset and update participant counts
    competitionParticipantsTotal.reset();
    for (const { status, _count } of participantsByStatus) {
      competitionParticipantsTotal.set({ status }, _count);
    }

    // Calculate averages
    if (serversWithData.length > 0) {
      avgPlayersPerServer.set(playersCount / serversWithData.length);
    } else {
      avgPlayersPerServer.set(0);
    }

    if (playersCount > 0) {
      avgAccountsPerPlayer.set(accountsCount / playersCount);
    } else {
      avgAccountsPerPlayer.set(0);
    }
  } catch (error) {
    logger.error("❌ Error updating usage metrics:", error);
    // Don't throw - we don't want metrics collection to crash the app
  }
}

// Update usage metrics every 5 minutes
setInterval(
  () => {
    void updateUsageMetrics();
  },
  5 * 60 * 1000,
);

// Initial update
void updateUsageMetrics();
