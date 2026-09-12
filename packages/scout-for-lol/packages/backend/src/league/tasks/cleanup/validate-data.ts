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
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getCompetitionsByChannelId } from "#src/database/competition/queries.ts";
import { botRest } from "#src/lib/discord/bot-rest.ts";
import type { DiscordChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import {
  installedGuildIdsAmong,
  isScoutInstalledInGuild,
} from "#src/lib/discord/installed-guilds.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import {
  discordSubscriptionsCleanedTotal,
  guildDataCleanupTotal,
} from "#src/metrics/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-validate-data");

/**
 * The database and the two guild-presence questions this cleanup asks,
 * injectable so the destructive path can be exercised without Discord — and,
 * because deleting is the whole point of this job, against a real schema
 * rather than against a mock that cannot roll a transaction back.
 */
export type GuildValidationDependencies = {
  /** The database every read and every delete in this job goes through. */
  readonly db: ExtendedPrismaClient;
  /** Which of these guilds have a live install row. One query, no Discord. */
  readonly installedAmong: (guildIds: string[]) => Promise<Set<string>>;
  /**
   * Whether Scout is installed in one guild, confirmed against Discord.
   * Throws when Discord could not be reached; never returns a guessed `false`.
   */
  readonly isInstalled: (guildId: string) => Promise<boolean>;
  /**
   * One channel straight from the bot REST API.
   *
   * `null` means Discord answered Unknown Channel; a throw means Scout could
   * not ask. Deliberately NOT `client.channels.fetch`: that helper performs the
   * REST read and then resolves `null` when it cannot attach the result to a
   * *cached guild*, so on a process with no gateway it reports every channel as
   * absent — and this function deletes what it is told is absent.
   */
  readonly readChannel: (channelId: string) => Promise<DiscordChannel | null>;
};

export function defaultGuildValidationDependencies(): GuildValidationDependencies {
  return {
    db: prisma,
    installedAmong: async (guildIds) => await installedGuildIdsAmong(guildIds),
    isInstalled: async (guildId) => await isScoutInstalledInGuild(guildId),
    readChannel: async (channelId) => await botRest().channel(channelId),
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
    await validateChannels(client, dependencies);

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
  dependencies: Pick<
    GuildValidationDependencies,
    "installedAmong" | "isInstalled"
  >,
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
    // Get all unique guild IDs from subscriptions. Ordered so a run that dies
    // partway through is resumable in the same order rather than in whatever
    // order the planner happened to produce.
    const storedGuilds = await dependencies.db.subscription.findMany({
      select: { serverId: true },
      distinct: ["serverId"],
      orderBy: { serverId: "asc" },
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

    // Clean up each orphaned guild. One guild's failure is isolated here and
    // nowhere below: the cleanup itself no longer catches, so this is the only
    // place that decides to keep going, and it decides that having seen the
    // error rather than in place of seeing it.
    for (const guildId of orphanedGuildIds) {
      try {
        await cleanupOrphanedGuild(dependencies.db, guildId);
      } catch (error) {
        logger.error(
          `[DataValidation] Error cleaning up guild ${guildId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: { source: "guild-cleanup", guildId },
        });
        guildDataCleanupTotal.inc({ data_type: "all", status: "failed" });
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
 * Delete one confirmed-gone guild's operational data, all or nothing.
 *
 * The three deletes are one transaction, for the same reason
 * `cleanup/remove-guild.ts` uses one: they are a single decision ("Scout is no
 * longer in this server"), and half of it is a worse state than either whole.
 * Run independently, a fault after the first delete left the guild with no
 * subscriptions and an intact permission table — Scout stops reporting, the
 * dashboard still lists collaborators, and the next hourly pass would have to
 * rediscover a half-deleted guild to finish the job.
 *
 * It also no longer catches its own errors. Swallowing them here made the
 * caller's per-guild handler unreachable, so a database fault was recorded as
 * a successful cleanup and the counts silently came back zero; the caller is
 * the one that knows there are other guilds to get to.
 */
async function cleanupOrphanedGuild(
  db: ExtendedPrismaClient,
  serverId: string,
): Promise<void> {
  logger.info(`[DataValidation] Cleaning up orphaned guild ${serverId}`);

  const guildId = DiscordGuildIdSchema.parse(serverId);

  const deleted = await db.$transaction(async (tx) => {
    const subscriptions = await tx.subscription.deleteMany({
      where: { serverId: guildId },
    });
    const permissions = await tx.serverPermission.deleteMany({
      where: { serverId: guildId },
    });
    const permissionErrors = await tx.guildPermissionError.deleteMany({
      where: { serverId: guildId },
    });
    return {
      subscriptions: subscriptions.count,
      permissions: permissions.count,
      permissionErrors: permissionErrors.count,
    };
  });

  // Counted only once the transaction committed: a rolled-back delete removed
  // nothing, and a metric that says otherwise is worse than no metric.
  if (deleted.subscriptions > 0) {
    logger.info(
      `[DataValidation]   Deleted ${deleted.subscriptions.toString()} subscription(s)`,
    );
    discordSubscriptionsCleanedTotal.inc(
      { reason: "periodic_validation_guild" },
      deleted.subscriptions,
    );
    guildDataCleanupTotal.inc({
      data_type: "subscriptions",
      status: "success",
    });
  }

  if (deleted.permissions > 0) {
    logger.info(
      `[DataValidation]   Deleted ${deleted.permissions.toString()} permission(s)`,
    );
    guildDataCleanupTotal.inc({
      data_type: "permissions",
      status: "success",
    });
  }

  if (deleted.permissionErrors > 0) {
    logger.info(
      `[DataValidation]   Deleted ${deleted.permissionErrors.toString()} error record(s)`,
    );
  }

  logger.info(`[DataValidation] ✅ Cleaned up guild ${serverId}`);
}

/**
 * Which stored channels Discord has confirmed no longer exist.
 *
 * Deleting is wired to this answer, so only an authoritative absence counts. The
 * bot REST port returns `null` for a confirmed Unknown Channel and throws for
 * everything else, so a rate limit, a 5xx or a timeout leaves the subscription
 * alone; skipping costs one more hourly cycle, deleting is permanent.
 *
 * The reader must be that port and not `client.channels.fetch`. That helper
 * performs the REST read and then resolves `null` when it cannot attach the
 * result to a *cached guild* — so on a process with no gateway connection it
 * reports every channel in every guild as absent, and this function would hand
 * back the entire subscription table as orphaned.
 */
export async function resolveOrphanedChannelIds(
  channelIds: readonly string[],
  dependencies: Pick<GuildValidationDependencies, "readChannel">,
): Promise<string[]> {
  const orphaned: string[] = [];
  for (const channelId of channelIds) {
    try {
      const channel = await dependencies.readChannel(channelId);
      if (channel === null) {
        logger.info(
          `[DataValidation] ⚠️  Channel ${channelId} no longer exists`,
        );
        orphaned.push(channelId);
      }
    } catch (error) {
      logger.warn(
        `[DataValidation] Could not check channel ${channelId}; leaving it alone: ${getErrorMessage(error)}`,
      );
    }
  }
  return orphaned;
}

/**
 * Validate that all stored channels still exist
 */
async function validateChannels(
  client: Client,
  dependencies: Pick<GuildValidationDependencies, "db" | "readChannel">,
): Promise<void> {
  logger.info("[DataValidation] Validating channels...");

  try {
    // Get all unique channel IDs from subscriptions
    const storedChannels = await dependencies.db.subscription.findMany({
      select: { channelId: true },
      distinct: ["channelId"],
    });

    logger.info(
      `[DataValidation] Found ${storedChannels.length.toString()} unique channels in database`,
    );

    const orphanedChannels = await resolveOrphanedChannelIds(
      storedChannels.map((row) => row.channelId),
      dependencies,
    );

    if (orphanedChannels.length === 0) {
      logger.info("[DataValidation] ✅ All stored channels are valid");
      return;
    }

    logger.info(
      `[DataValidation] Found ${orphanedChannels.length.toString()} orphaned channel(s)`,
    );

    // Clean up orphaned channels and notify owners (grouped by owner)
    await cleanupOrphanedChannels(dependencies.db, client, orphanedChannels);

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
  db: ExtendedPrismaClient,
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
      const deletedSubs = await db.subscription.deleteMany({
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
        db,
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
