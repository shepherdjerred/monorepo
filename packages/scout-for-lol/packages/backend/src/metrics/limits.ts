/**
 * Update metrics for servers at/approaching limits
 * This persists state to Prometheus by querying current database state
 */

import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  serversAtSubscriptionLimit,
  serversApproachingSubscriptionLimit,
  serversAtAccountLimit,
  serversApproachingAccountLimit,
} from "@scout-for-lol/backend/metrics/index.ts";
import { getLimit } from "@scout-for-lol/backend/configuration/flags.ts";
import { LIMIT_WARNING_THRESHOLD } from "@scout-for-lol/backend/configuration/subscription-limits.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("metrics-limits");

/**
 * Update limit metrics based on current database state
 * This should be called periodically (e.g., every minute) to keep metrics current
 */
export async function updateLimitMetrics(): Promise<void> {
  try {
    // Get all servers and their current usage
    const servers = await prisma.player.groupBy({
      by: ["serverId"],
      _count: {
        id: true,
      },
    });

    // Track servers by limit status
    let atSubLimit = 0;
    let approachingSubLimit = 0;
    let atAcctLimit = 0;
    let approachingAcctLimit = 0;

    for (const server of servers) {
      const serverId = DiscordGuildIdSchema.parse(server.serverId);

      // Count subscribed players
      const subscribedPlayers = await prisma.player.count({
        where: {
          serverId,
          subscriptions: {
            some: {},
          },
        },
      });

      // Count accounts
      const accountCount = await prisma.account.count({
        where: {
          serverId,
        },
      });

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
