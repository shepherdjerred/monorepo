import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { GuildMember, OAuth2Guild } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";

const logger = loggers.scheduler.child("activity-aggregator");

type RoleTier = { roleId: string; minimumActivity: number };

async function processMemberActivity(
  member: GuildMember,
  guildId: string,
  userId: string,
  roleTiers: RoleTier[],
): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const activityCount = await prisma.userActivity.count({
    where: { guildId, userId, createdAt: { gte: thirtyDaysAgo } },
  });

  const qualifiedTier =
    roleTiers
      .toSorted((a, b) => b.minimumActivity - a.minimumActivity)
      .find((tier) => activityCount >= tier.minimumActivity) ?? null;

  const currentActivityRoles = member.roles.cache.filter((role) =>
    roleTiers.some((tier) => tier.roleId === role.id),
  );

  if (qualifiedTier == null) {
    for (const [roleId] of currentActivityRoles) {
      await member.roles.remove(roleId);
      logger.info("Removed activity role (no longer qualified)", {
        guildId,
        userId,
        roleId,
        activityCount,
      });
    }
    return;
  }

  const shouldHaveRole = qualifiedTier.roleId;
  if (!member.roles.cache.has(shouldHaveRole)) {
    await member.roles.add(shouldHaveRole);
    logger.info("Added activity role", {
      guildId,
      userId,
      roleId: shouldHaveRole,
      activityCount,
    });
  }

  for (const [roleId] of currentActivityRoles) {
    if (roleId !== shouldHaveRole) {
      await member.roles.remove(roleId);
      logger.info("Removed old activity role", { guildId, userId, roleId });
    }
  }
}

async function processGuildMembers(
  members: Map<string, GuildMember>,
  guildId: string,
  roleTiers: RoleTier[],
): Promise<void> {
  for (const [userId, member] of members) {
    if (member.user.bot) {
      continue;
    }
    try {
      await processMemberActivity(member, guildId, userId, roleTiers);
    } catch (error) {
      logger.error("Failed to process activity for member", toError(error), {
        guildId,
        userId,
      });
    }
  }
}

async function processGuildActivity(
  guild: OAuth2Guild,
  guildId: string,
  roleTiers: RoleTier[],
): Promise<void> {
  try {
    if (roleTiers.length === 0) {
      return;
    }
    const fullGuild = await guild.fetch();
    logger.debug("Processing activity roles for guild", {
      guildId,
      tierCount: roleTiers.length,
    });
    const members = await fullGuild.members.fetch();
    await processGuildMembers(members, guildId, roleTiers);
    logger.info("Activity aggregation completed for guild", { guildId });
  } catch (error) {
    logger.error("Failed to aggregate activity for guild", toError(error), {
      guildId,
    });
  }
}

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
      const guilds = await client.guilds.fetch();

      for (const [guildId, guild] of guilds) {
        await processGuildActivity(
          guild,
          guildId,
          config.activityTracking.roleTiers,
        );
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const deleted = await prisma.userActivity.deleteMany({
        where: { createdAt: { lt: ninetyDaysAgo } },
      });

      logger.info("Activity aggregation completed", {
        cleanedRecords: deleted.count,
      });
    } catch (error) {
      logger.error("Activity aggregator job failed", toError(error));
    }
  });
}
