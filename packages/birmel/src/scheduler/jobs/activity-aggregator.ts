import { getDiscordClient } from "../../discord/index.js";
import { withSpan } from "../../observability/index.js";
import { loggers } from "../../utils/logger.js";
import { getConfig } from "../../config/index.js";
import { prisma } from "../../database/index.js";

const logger = loggers.scheduler.child("activity-aggregator");

/**
 * Aggregate activity metrics and assign/remove activity-based roles
 * Runs every hour
 */
export async function aggregateActivityMetrics(): Promise<void> {
  return withSpan("job.aggregate-activity", {}, async () => {
    try {
      logger.info("Starting activity aggregation");

      const client = getDiscordClient();
      const config = getConfig();

      // Get all guilds the bot is in
      const guilds = await client.guilds.fetch();

      for (const [guildId, guild] of guilds) {
        try {
          // Fetch full guild data
          const fullGuild = await guild.fetch();

          // Get activity role tiers if configured
          const roleTiers = config.activityTracking.roleTiers;

          if (roleTiers.length === 0) {
            // No role tiers configured, skip role assignment
            continue;
          }

          logger.debug("Processing activity roles for guild", {
            guildId,
            tierCount: roleTiers.length
          });

          // Get all members in the guild
          const members = await fullGuild.members.fetch();

          for (const [userId, member] of members) {
            if (member.user.bot) {
              continue; // Skip bots
            }

            try {
              // Get activity count for the last 30 days
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

              const activityCount = await prisma.userActivity.count({
                where: {
                  guildId,
                  userId,
                  createdAt: {
                    gte: thirtyDaysAgo
                  }
                }
              });

              // Determine which tier the user qualifies for
              let qualifiedTier = null;
              for (const tier of roleTiers.sort((a, b) => b.minimumActivity - a.minimumActivity)) {
                if (activityCount >= tier.minimumActivity) {
                  qualifiedTier = tier;
                  break;
                }
              }

              // Get current activity roles the user has
              const currentActivityRoles = member.roles.cache.filter(role =>
                roleTiers.some(tier => tier.roleId === role.id)
              );

              if (qualifiedTier) {
                // User qualifies for a tier
                const shouldHaveRole = qualifiedTier.roleId;

                if (!member.roles.cache.has(shouldHaveRole)) {
                  // Add the qualified role
                  await member.roles.add(shouldHaveRole);
                  logger.info("Added activity role", {
                    guildId,
                    userId,
                    roleId: shouldHaveRole,
                    activityCount
                  });
                }

                // Remove other activity tier roles
                for (const [roleId, _role] of currentActivityRoles) {
                  if (roleId !== shouldHaveRole) {
                    await member.roles.remove(roleId);
                    logger.info("Removed old activity role", {
                      guildId,
                      userId,
                      roleId
                    });
                  }
                }
              } else {
                // User doesn't qualify for any tier, remove all activity roles
                for (const [roleId, _role] of currentActivityRoles) {
                  await member.roles.remove(roleId);
                  logger.info("Removed activity role (no longer qualified)", {
                    guildId,
                    userId,
                    roleId,
                    activityCount
                  });
                }
              }
            } catch (error) {
              logger.error("Failed to process activity for member", error as Error, {
                guildId,
                userId
              });
            }
          }

          logger.info("Activity aggregation completed for guild", { guildId });
        } catch (error) {
          logger.error("Failed to aggregate activity for guild", error as Error, {
            guildId
          });
        }
      }

      // Clean up old activity records (older than 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const deleted = await prisma.userActivity.deleteMany({
        where: {
          createdAt: {
            lt: ninetyDaysAgo
          }
        }
      });

      logger.info("Activity aggregation completed", {
        cleanedRecords: deleted.count
      });
    } catch (error) {
      logger.error("Activity aggregator job failed", error as Error);
    }
  });
}
