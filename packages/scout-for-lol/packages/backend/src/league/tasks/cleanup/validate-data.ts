/**
 * Data Validation Task
 *
 * Validates stored data against Discord's current state.
 * Runs periodically to clean up orphaned guilds and channels.
 */

import { type Client } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getCompetitionsByChannelId } from "#src/database/competition/queries.ts";
import {
  installedGuildIdsAmong,
  isScoutInstalledInGuild,
} from "#src/lib/discord/installed-guilds.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { isMissingChannelError } from "#src/discord/utils/permissions.ts";
import {
  discordSubscriptionsCleanedTotal,
  guildDataCleanupTotal,
} from "#src/metrics/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-validate-data");

/**
 * The two guild-presence questions this cleanup asks, injectable so the
 * destructive path can be exercised without Discord.
 */
export type GuildValidationDependencies = {
  /** Which of these guilds have a live install row. One query, no Discord. */
  readonly installedAmong: (guildIds: string[]) => Promise<Set<string>>;
  /**
   * Whether Scout is installed in one guild, confirmed against Discord.
   * Throws when Discord could not be reached; never returns a guessed `false`.
   */
  readonly isInstalled: (guildId: string) => Promise<boolean>;
};

export function defaultGuildValidationDependencies(): GuildValidationDependencies {
  return {
    installedAmong: async (guildIds) => await installedGuildIdsAmong(guildIds),
    isInstalled: async (guildId) => await isScoutInstalledInGuild(guildId),
  };
}

/**
 * Run data validation to clean up orphaned guilds and channels
 *
 * This function:
 * 1. Finds guilds in database that bot is no longer a member of
 * 2. Finds channels in database that no longer exist
 * 3. Cleans up orphaned data
 * 4. Notifies competition owners if their channels were deleted
 */
export async function runDataValidation(
  client: Client,
  dependencies: GuildValidationDependencies = defaultGuildValidationDependencies(),
): Promise<void> {
  logger.info("[DataValidation] Starting data validation...");
  const startTime = Date.now();

  try {
    // Validate guilds first (this cleans up all data for missing guilds)
    await validateGuilds(dependencies);

    // Then validate channels (for guilds that still exist)
    await validateChannels(client);

    const duration = Date.now() - startTime;
    logger.info(
      `[DataValidation] ✅ Validation complete in ${duration.toString()}ms`,
    );
  } catch (error) {
    logger.error(
      "[DataValidation] Error during validation:",
      getErrorMessage(error),
    );
    Sentry.captureException(error, { tags: { source: "data-validation" } });
    throw error;
  }
}

/**
 * Which stored guilds Scout has authoritatively been removed from.
 *
 * This decides what gets DELETED, so it may only ever report a guild whose
 * absence Discord itself confirmed. It used to read `client.guilds.cache`,
 * which made the answer a property of *this process* rather than of Discord:
 * on any process without a gateway connection the cache is permanently empty,
 * so every guild with a subscription was classified orphaned and its
 * subscriptions, permissions and error records were deleted. A shard that had
 * merely not finished backfilling produced the same result on a smaller scale.
 *
 * Two steps, for cost as much as for correctness. The install table answers for
 * every stored guild in one query, and a live row is proof of presence. Only
 * the remainder — the deletion candidates — are confirmed against Discord over
 * REST, one call each. {@link isScoutInstalledInGuild} throws rather than
 * returning `false` when it cannot reach Discord, and that throw propagates:
 * "Scout could not ask" must never become "Scout was removed" when the answer
 * is wired to `deleteMany`.
 */
export async function resolveOrphanedGuildIds(
  storedGuildIds: readonly string[],
  dependencies: GuildValidationDependencies,
): Promise<string[]> {
  const installed = await dependencies.installedAmong([...storedGuildIds]);
  const candidates = storedGuildIds.filter((id) => !installed.has(id));
  const orphaned: string[] = [];
  for (const guildId of candidates) {
    if (!(await dependencies.isInstalled(guildId))) orphaned.push(guildId);
  }
  return orphaned;
}

/**
 * Validate that all stored guilds still exist (bot is still a member)
 */
async function validateGuilds(
  dependencies: GuildValidationDependencies,
): Promise<void> {
  logger.info("[DataValidation] Validating guilds...");

  try {
    // Get all unique guild IDs from subscriptions
    const storedGuilds = await prisma.subscription.findMany({
      select: { serverId: true },
      distinct: ["serverId"],
    });

    const storedGuildIds = storedGuilds.map((s) => s.serverId);
    logger.info(
      `[DataValidation] Found ${storedGuildIds.length.toString()} unique guilds in database`,
    );

    const orphanedGuildIds = await resolveOrphanedGuildIds(
      storedGuildIds,
      dependencies,
    );

    if (orphanedGuildIds.length === 0) {
      logger.info("[DataValidation] ✅ All stored guilds are valid");
      return;
    }

    logger.info(
      `[DataValidation] ⚠️  Found ${orphanedGuildIds.length.toString()} orphaned guild(s)`,
    );

    // Clean up each orphaned guild
    for (const guildId of orphanedGuildIds) {
      try {
        await cleanupOrphanedGuild(guildId);
      } catch (error) {
        logger.error(
          `[DataValidation] Error cleaning up guild ${guildId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: { source: "guild-cleanup", guildId },
        });
        // Continue with other guilds
      }
    }
  } catch (error) {
    logger.error(
      "[DataValidation] Error validating guilds:",
      getErrorMessage(error),
    );
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
      logger.info(
        `[DataValidation]   Deleted ${deletedSubs.count.toString()} subscription(s)`,
      );
      discordSubscriptionsCleanedTotal.inc(
        { reason: "periodic_validation_guild" },
        deletedSubs.count,
      );
      guildDataCleanupTotal.inc({
        data_type: "subscriptions",
        status: "success",
      });
    }

    // Delete server permissions
    const deletedPerms = await prisma.serverPermission.deleteMany({
      where: { serverId: guildId },
    });

    if (deletedPerms.count > 0) {
      logger.info(
        `[DataValidation]   Deleted ${deletedPerms.count.toString()} permission(s)`,
      );
      guildDataCleanupTotal.inc({
        data_type: "permissions",
        status: "success",
      });
    }

    // Delete permission error records
    const deletedErrors = await prisma.guildPermissionError.deleteMany({
      where: { serverId: guildId },
    });

    if (deletedErrors.count > 0) {
      logger.info(
        `[DataValidation]   Deleted ${deletedErrors.count.toString()} error record(s)`,
      );
    }

    logger.info(`[DataValidation] ✅ Cleaned up guild ${serverId}`);
  } catch (error) {
    logger.error(
      `[DataValidation] Error cleaning up guild ${serverId}:`,
      getErrorMessage(error),
    );
    Sentry.captureException(error, {
      tags: { source: "cleanup-orphaned-guild", serverId },
    });
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

    logger.info(
      `[DataValidation] Found ${storedChannels.length.toString()} unique channels in database`,
    );

    // Collect orphaned channels
    const orphanedChannels: string[] = [];

    for (const { channelId } of storedChannels) {
      // Only an authoritative absence may delete a subscription. A resolved
      // `null`, or an Unknown Channel / Unknown Guild code, is Discord saying
      // the channel is gone. Anything else — a rate limit, a 5xx, a timeout —
      // means Scout could not ask, and the previous `.catch(() => null)`
      // collapsed that into "no longer exists" and deleted the subscription
      // anyway. Skipping costs one more hourly cycle; deleting is permanent.
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel === null) {
          logger.info(
            `[DataValidation] ⚠️  Channel ${channelId} no longer exists`,
          );
          orphanedChannels.push(channelId);
        }
      } catch (error) {
        if (isMissingChannelError(error)) {
          logger.info(
            `[DataValidation] ⚠️  Channel ${channelId} no longer exists`,
          );
          orphanedChannels.push(channelId);
          continue;
        }
        logger.warn(
          `[DataValidation] Could not check channel ${channelId}; leaving it alone: ${getErrorMessage(error)}`,
        );
      }
    }

    if (orphanedChannels.length === 0) {
      logger.info("[DataValidation] ✅ All stored channels are valid");
      return;
    }

    logger.info(
      `[DataValidation] Found ${orphanedChannels.length.toString()} orphaned channel(s)`,
    );

    // Clean up orphaned channels and notify owners (grouped by owner)
    await cleanupOrphanedChannels(client, orphanedChannels);

    logger.info(
      `[DataValidation] ✅ Cleaned up ${orphanedChannels.length.toString()} orphaned channel(s)`,
    );
  } catch (error) {
    logger.error(
      "[DataValidation] Error validating channels:",
      getErrorMessage(error),
    );
    Sentry.captureException(error, { tags: { source: "validate-channels" } });
    throw error;
  }
}

/**
 * Clean up data for channels that no longer exist and notify owners
 * Groups notifications by owner to prevent spam
 */
async function cleanupOrphanedChannels(
  client: Client,
  channelIds: string[],
): Promise<void> {
  try {
    // Collect all competitions affected by deleted channels, grouped by owner
    const competitionsByOwner = new Map<
      string,
      { id: number; title: string }[]
    >();

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
        discordSubscriptionsCleanedTotal.inc(
          { reason: "periodic_validation_channel" },
          deletedSubs.count,
        );
      }

      // Get competitions using this channel
      const competitions = await getCompetitionsByChannelId(
        prisma,
        parsedChannelId,
      );

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
• If any competition is still active, manage it from the Scout dashboard
• The competition data is preserved in the database

If you have any questions, feel free to reach out for support.`;

        const parsedOwnerId = DiscordAccountIdSchema.parse(ownerId);
        const status = await sendDM({
          client,
          userId: parsedOwnerId,
          message,
          kind: "data_validation",
        });
        if (status === "sent") {
          logger.info(
            `[DataValidation]   Notified owner ${ownerId} about ${competitions.length.toString()} competition(s)`,
          );
        }
      } catch (error) {
        logger.error(
          `[DataValidation]   Failed to notify owner ${ownerId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: { source: "notify-owner-channel-cleanup", ownerId },
        });
      }
    }
  } catch (error) {
    logger.error(
      `[DataValidation] Error cleaning up orphaned channels:`,
      getErrorMessage(error),
    );
    Sentry.captureException(error, {
      tags: { source: "cleanup-orphaned-channels" },
    });
  }
}
