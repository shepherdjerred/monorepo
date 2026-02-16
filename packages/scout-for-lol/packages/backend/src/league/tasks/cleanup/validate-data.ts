/**
 * Data Validation Task
 *
 * Validates stored data against Discord's current state.
 * Runs periodically to clean up orphaned guilds and channels.
 */

import { type Client } from "discord.js";
import { DiscordAccountIdSchema, DiscordChannelIdSchema, DiscordGuildIdSchema } from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionsByChannelId } from "@scout-for-lol/backend/database/competition/queries.ts";
import { sendDM } from "@scout-for-lol/backend/discord/utils/dm.ts";
import { discordSubscriptionsCleanedTotal, guildDataCleanupTotal } from "@scout-for-lol/backend/metrics/index.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("cleanup-validate-data");

/**
 * Run data validation to clean up orphaned guilds and channels
 *
 * This function:
 * 1. Finds guilds in database that bot is no longer a member of
 * 2. Finds channels in database that no longer exist
 * 3. Cleans up orphaned data
 * 4. Notifies competition owners if their channels were deleted
 */
export async function runDataValidation(client: Client): Promise<void> {
  logger.info("[DataValidation] Starting data validation...");
  const startTime = Date.now();

  try {
    // Validate guilds first (this cleans up all data for missing guilds)
    await validateGuilds(client);

    // Then validate channels (for guilds that still exist)
    await validateChannels(client);

    const duration = Date.now() - startTime;
    logger.info(`[DataValidation] ✅ Validation complete in ${duration.toString()}ms`);
  } catch (error) {
    logger.error("[DataValidation] Error during validation:", getErrorMessage(error));
    Sentry.captureException(error, { tags: { source: "data-validation" } });
    throw error;
  }
}

/**
 * Validate that all stored guilds still exist (bot is still a member)
 */
async function validateGuilds(client: Client): Promise<void> {
  logger.info("[DataValidation] Validating guilds...");

  try {
    // Get all unique guild IDs from subscriptions
    const storedGuilds = await prisma.subscription.findMany({
      select: { serverId: true },
      distinct: ["serverId"],
    });

    const storedGuildIds = storedGuilds.map((s) => s.serverId);
    logger.info(`[DataValidation] Found ${storedGuildIds.length.toString()} unique guilds in database`);

    // Get guilds bot is currently in
    const activeGuildIds = new Set(client.guilds.cache.keys());
    logger.info(`[DataValidation] Bot is currently in ${activeGuildIds.size.toString()} guilds`);

    // Find guilds bot is no longer in
    const orphanedGuildIds = storedGuildIds.filter((id) => !activeGuildIds.has(id));

    if (orphanedGuildIds.length === 0) {
      logger.info("[DataValidation] ✅ All stored guilds are valid");
      return;
    }

    logger.info(`[DataValidation] ⚠️  Found ${orphanedGuildIds.length.toString()} orphaned guild(s)`);

    // Clean up each orphaned guild
    for (const guildId of orphanedGuildIds) {
      try {
        await cleanupOrphanedGuild(guildId);
      } catch (error) {
        logger.error(`[DataValidation] Error cleaning up guild ${guildId}:`, getErrorMessage(error));
        Sentry.captureException(error, { tags: { source: "guild-cleanup", guildId } });
        // Continue with other guilds
      }
    }
  } catch (error) {
    logger.error("[DataValidation] Error validating guilds:", getErrorMessage(error));
    Sentry.captureException(error, { tags: { source: "validate-guilds" } });
    throw error;
  }
}

/**
 * Clean up data for a guild the bot is no longer in
 */
async function cleanupOrphanedGuild(serverId: string): Promise<void> {
  logger.info(`[DataValidation] Cleaning up orphaned guild ${serverId}`);

  try {
    const guildId = DiscordGuildIdSchema.parse(serverId);

    // Delete subscriptions
    const deletedSubs = await prisma.subscription.deleteMany({
      where: { serverId: guildId },
    });

    if (deletedSubs.count > 0) {
      logger.info(`[DataValidation]   Deleted ${deletedSubs.count.toString()} subscription(s)`);
      discordSubscriptionsCleanedTotal.inc({ reason: "periodic_validation_guild" }, deletedSubs.count);
      guildDataCleanupTotal.inc({ data_type: "subscriptions", status: "success" });
    }

    // Delete server permissions
    const deletedPerms = await prisma.serverPermission.deleteMany({
      where: { serverId: guildId },
    });

    if (deletedPerms.count > 0) {
      logger.info(`[DataValidation]   Deleted ${deletedPerms.count.toString()} permission(s)`);
      guildDataCleanupTotal.inc({ data_type: "permissions", status: "success" });
    }

    // Delete permission error records
    const deletedErrors = await prisma.guildPermissionError.deleteMany({
      where: { serverId: guildId },
    });

    if (deletedErrors.count > 0) {
      logger.info(`[DataValidation]   Deleted ${deletedErrors.count.toString()} error record(s)`);
    }

    logger.info(`[DataValidation] ✅ Cleaned up guild ${serverId}`);
  } catch (error) {
    logger.error(`[DataValidation] Error cleaning up guild ${serverId}:`, getErrorMessage(error));
    Sentry.captureException(error, { tags: { source: "cleanup-orphaned-guild", serverId } });
    guildDataCleanupTotal.inc({ data_type: "all", status: "failed" });
  }
}

/**
 * Validate that all stored channels still exist
 */
async function validateChannels(client: Client): Promise<void> {
  logger.info("[DataValidation] Validating channels...");

  try {
    // Get all unique channel IDs from subscriptions
    const storedChannels = await prisma.subscription.findMany({
      select: { channelId: true },
      distinct: ["channelId"],
    });

    logger.info(`[DataValidation] Found ${storedChannels.length.toString()} unique channels in database`);

    // Collect orphaned channels
    const orphanedChannels: string[] = [];

    for (const { channelId } of storedChannels) {
      try {
        // Try to fetch the channel
        const channel = await client.channels.fetch(channelId).catch(() => null);

        if (!channel) {
          // Channel doesn't exist
          logger.info(`[DataValidation] ⚠️  Channel ${channelId} no longer exists`);
          orphanedChannels.push(channelId);
        }
      } catch (error) {
        // Error fetching channel - likely doesn't exist
        logger.info(`[DataValidation] ⚠️  Channel ${channelId} could not be fetched: ${getErrorMessage(error)}`);
        orphanedChannels.push(channelId);
      }
    }

    if (orphanedChannels.length === 0) {
      logger.info("[DataValidation] ✅ All stored channels are valid");
      return;
    }

    logger.info(`[DataValidation] Found ${orphanedChannels.length.toString()} orphaned channel(s)`);

    // Clean up orphaned channels and notify owners (grouped by owner)
    await cleanupOrphanedChannels(client, orphanedChannels);

    logger.info(`[DataValidation] ✅ Cleaned up ${orphanedChannels.length.toString()} orphaned channel(s)`);
  } catch (error) {
    logger.error("[DataValidation] Error validating channels:", getErrorMessage(error));
    Sentry.captureException(error, { tags: { source: "validate-channels" } });
    throw error;
  }
}

/**
 * Clean up data for channels that no longer exist and notify owners
 * Groups notifications by owner to prevent spam
 */
async function cleanupOrphanedChannels(client: Client, channelIds: string[]): Promise<void> {
  try {
    // Collect all competitions affected by deleted channels, grouped by owner
    const competitionsByOwner = new Map<string, { id: number; title: string }[]>();

    for (const channelId of channelIds) {
      const parsedChannelId = DiscordChannelIdSchema.parse(channelId);

      // Delete subscriptions for this channel
      const deletedSubs = await prisma.subscription.deleteMany({
        where: { channelId: parsedChannelId },
      });

      if (deletedSubs.count > 0) {
        logger.info(
          `[DataValidation]   Deleted ${deletedSubs.count.toString()} subscription(s) for channel ${channelId}`,
        );
        discordSubscriptionsCleanedTotal.inc({ reason: "periodic_validation_channel" }, deletedSubs.count);
      }

      // Get competitions using this channel
      const competitions = await getCompetitionsByChannelId(prisma, parsedChannelId);

      // Group competitions by owner
      for (const competition of competitions) {
        const ownerId = competition.ownerId;
        if (!competitionsByOwner.has(ownerId)) {
          competitionsByOwner.set(ownerId, []);
        }
        competitionsByOwner.get(ownerId)?.push({
          id: competition.id,
          title: competition.title,
        });
      }

      logger.info(`[DataValidation] ✅ Cleaned up channel ${channelId}`);
    }

    // Send grouped notifications to each owner
    for (const [ownerId, competitions] of competitionsByOwner.entries()) {
      try {
        const competitionList = competitions
          .map((comp) => `• **${comp.title}** (ID: ${comp.id.toString()})`)
          .join("\n");

        const message = `⚠️ **Competition Channel${competitions.length > 1 ? "s" : ""} Missing**

${competitions.length > 1 ? `${competitions.length.toString()} of your competitions were` : "Your competition was"} in ${competitions.length > 1 ? "channels that no longer exist" : "a channel that no longer exists"}.

**Affected competition${competitions.length > 1 ? "s" : ""}:**
${competitionList}

The ${competitions.length > 1 ? "channels may" : "channel may"} have been deleted.

**What should you do?**
• If any competition is still active, you may want to cancel it with \`/competition cancel\`
• The competition data is preserved in the database

If you have any questions, feel free to reach out for support.`;

        const parsedOwnerId = DiscordAccountIdSchema.parse(ownerId);
        const success = await sendDM(client, parsedOwnerId, message);
        if (success) {
          logger.info(
            `[DataValidation]   Notified owner ${ownerId} about ${competitions.length.toString()} competition(s)`,
          );
        }
      } catch (error) {
        logger.error(`[DataValidation]   Failed to notify owner ${ownerId}:`, getErrorMessage(error));
        Sentry.captureException(error, { tags: { source: "notify-owner-channel-cleanup", ownerId } });
      }
    }
  } catch (error) {
    logger.error(`[DataValidation] Error cleaning up orphaned channels:`, getErrorMessage(error));
    Sentry.captureException(error, { tags: { source: "cleanup-orphaned-channels" } });
  }
}
