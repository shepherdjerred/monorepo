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
} from "#src/metrics/index.ts";
import {
  guildSendBlocked,
  guildSendBlockedTotal,
  competitionUnhealthy,
  competitionUnhealthyTotal,
  guildInfo,
  guildUnconfigured,
  guildUnconfiguredTotal,
} from "#src/metrics/guild-health.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("metrics-usage");

/**
 * Update usage metrics from database
 * This function queries the database to get current counts and updates the gauges.
 * Accepts an optional client for tests; defaults to the shared Prisma client
 * (imported lazily to avoid circular dependencies at module load).
 */
export async function updateUsageMetrics(
  prismaClient?: ExtendedPrismaClient,
): Promise<void> {
  try {
    // Imported lazily to avoid circular dependencies at module load.
    const databaseModule = await import("../database/index.js");
    const prisma = prismaClient ?? databaseModule.prisma;

    // Get total counts
    const [
      playersCount,
      accountsCount,
      activeCompetitionsCount,
      totalCompetitionsCount,
      subscriptionsCount,
    ] = await Promise.all([
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

    // --- Guild health ---

    // Guilds where the bot is present but message delivery is currently failing
    // (any channel with an active error streak).
    const blockedGuilds = await prisma.guildPermissionError.findMany({
      where: { consecutiveErrorCount: { gt: 0 } },
      select: { serverId: true },
      distinct: ["serverId"],
    });
    guildSendBlocked.reset();
    for (const { serverId } of blockedGuilds) {
      guildSendBlocked.set({ server_id: serverId }, 1);
    }
    guildSendBlockedTotal.set(blockedGuilds.length);

    // Active competitions whose leaderboard report last failed to generate.
    const unhealthyCompetitions = await prisma.report.findMany({
      where: {
        isEnabled: true,
        sourceCompetitionId: { not: null },
        lastRunStatus: "FAILED",
      },
      select: { serverId: true, sourceCompetitionId: true },
    });
    competitionUnhealthy.reset();
    for (const report of unhealthyCompetitions) {
      if (report.sourceCompetitionId === null) {
        continue;
      }
      competitionUnhealthy.set(
        {
          server_id: report.serverId,
          competition_id: report.sourceCompetitionId.toString(),
        },
        1,
      );
    }
    competitionUnhealthyTotal.set(unhealthyCompetitions.length);

    // Name lookup series for joining the opaque server_id labels above.
    const installs = await prisma.guildInstall.findMany({
      select: { serverId: true, serverName: true },
    });
    guildInfo.reset();
    for (const install of installs) {
      guildInfo.set(
        { server_id: install.serverId, server_name: install.serverName },
        1,
      );
    }

    // Installed-but-unconfigured guilds: have the bot, but no subscriptions and
    // no active competitions, so nothing will ever post.
    const [subscribedGuilds, competitionGuilds] = await Promise.all([
      prisma.subscription.findMany({
        select: { serverId: true },
        distinct: ["serverId"],
      }),
      prisma.competition.findMany({
        where: { isCancelled: false },
        select: { serverId: true },
        distinct: ["serverId"],
      }),
    ]);
    const configuredServerIds = new Set([
      ...subscribedGuilds.map((row) => row.serverId),
      ...competitionGuilds.map((row) => row.serverId),
    ]);
    const unconfigured = installs.filter(
      (install) => !configuredServerIds.has(install.serverId),
    );
    guildUnconfigured.reset();
    for (const install of unconfigured) {
      guildUnconfigured.set({ server_id: install.serverId }, 1);
    }
    guildUnconfiguredTotal.set(unconfigured.length);
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
