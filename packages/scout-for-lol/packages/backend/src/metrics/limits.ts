/**
 * Update metrics for servers at/approaching limits
 * This persists state to Prometheus by querying current database state
 */

import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  serversAtSubscriptionLimit,
  serversApproachingSubscriptionLimit,
  serversAtAccountLimit,
  serversApproachingAccountLimit,
} from "#src/metrics/index.ts";
import { getLimit } from "#src/configuration/flags.ts";
import { LIMIT_WARNING_THRESHOLD } from "#src/configuration/subscription-limits.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("metrics-limits");

/**
 * Update limit metrics based on current database state
 * This should be called periodically (e.g., every minute) to keep metrics current
 */
export async function updateLimitMetrics(
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  try {
    // Three grouped reads for every server at once, instead of two counts per
    // server on each sweep.
    const [servers, subscribedByServer, accountsByServer] = await Promise.all([
      db.player.groupBy({ by: ["serverId"] }),
      db.player.groupBy({
        by: ["serverId"],
        where: { subscriptions: { some: {} } },
        _count: { _all: true },
      }),
      db.account.groupBy({
        by: ["serverId"],
        _count: { _all: true },
      }),
    ]);
    const subscribedCounts = new Map(
      subscribedByServer.map((row) => [row.serverId, row._count._all]),
    );
    const accountCounts = new Map(
      accountsByServer.map((row) => [row.serverId, row._count._all]),
    );

    // Track servers by limit status
    let atSubLimit = 0;
    let approachingSubLimit = 0;
    let atAcctLimit = 0;
    let approachingAcctLimit = 0;

    for (const server of servers) {
      const serverId = DiscordGuildIdSchema.parse(server.serverId);
      const subscribedPlayers = subscribedCounts.get(server.serverId) ?? 0;
      const accountCount = accountCounts.get(server.serverId) ?? 0;

      // Check subscription limits
      const subLimit = getLimit("player_subscriptions", { server: serverId });
      if (subLimit === "unlimited") {
        // noop
      } else if (subscribedPlayers >= subLimit) {
        atSubLimit++;
      } else if (subscribedPlayers >= subLimit - LIMIT_WARNING_THRESHOLD) {
        approachingSubLimit++;
      }

      // Check account limits
      const acctLimit = getLimit("accounts", { server: serverId });
      if (acctLimit === "unlimited") {
        // noop
      } else if (accountCount >= acctLimit) {
        atAcctLimit++;
      } else if (accountCount >= acctLimit - LIMIT_WARNING_THRESHOLD) {
        approachingAcctLimit++;
      }
    }

    // Update metrics
    serversAtSubscriptionLimit.set(atSubLimit);
    serversApproachingSubscriptionLimit.set(approachingSubLimit);
    serversAtAccountLimit.set(atAcctLimit);
    serversApproachingAccountLimit.set(approachingAcctLimit);
  } catch (error) {
    logger.error("Failed to update limit metrics:", error);
  }
}
