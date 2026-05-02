import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import type { GuildMember, OAuth2Guild } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  runScheduledJob,
  throwIfAborted,
} from "@shepherdjerred/birmel/scheduler/utils/job-runner.ts";

const logger = loggers.scheduler.child("activity-aggregator");

type RoleTier = { roleId: string; minimumActivity: number };

type ProcessMemberActivityArgs = {
  member: GuildMember;
  guildId: string;
  userId: string;
  roleTiers: RoleTier[];
  signal: AbortSignal;
};

async function processMemberActivity(
  args: ProcessMemberActivityArgs,
): Promise<void> {
  const { member, guildId, userId, roleTiers, signal } = args;
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
      throwIfAborted(signal);
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
    throwIfAborted(signal);
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
      throwIfAborted(signal);
      await member.roles.remove(roleId);
      logger.info("Removed old activity role", { guildId, userId, roleId });
    }
  }
}

async function processGuildMembers(
  members: Map<string, GuildMember>,
  guildId: string,
  roleTiers: RoleTier[],
  signal: AbortSignal,
): Promise<void> {
  for (const [userId, member] of members) {
    throwIfAborted(signal);
    if (member.user.bot) {
      continue;
    }
    try {
      await processMemberActivity({
        member,
        guildId,
        userId,
        roleTiers,
        signal,
      });
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
  signal: AbortSignal,
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
    await processGuildMembers(members, guildId, roleTiers, signal);
    logger.info("Activity aggregation completed for guild", { guildId });
  } catch (error) {
    logger.error("Failed to aggregate activity for guild", toError(error), {
      guildId,
    });
  }
}

/**
 * Aggregate activity metrics and assign/remove activity-based roles
 * Runs every hour.
 */
export async function aggregateActivityMetrics(): Promise<void> {
  return runScheduledJob(
    { name: "aggregate-activity", timeoutMs: 5 * 60 * 1000 },
    async (signal) => {
      logger.info("Starting activity aggregation");

      const client = getDiscordClient();
      const config = getConfig();
      const guilds = await client.guilds.fetch();
      throwIfAborted(signal);

      for (const [guildId, guild] of guilds) {
        throwIfAborted(signal);
        await processGuildActivity(
          guild,
          guildId,
          config.activityTracking.roleTiers,
          signal,
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
    },
  );
}
