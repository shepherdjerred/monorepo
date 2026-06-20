import type { Client } from "discord.js";
import * as Sentry from "@sentry/bun";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-reconcile-removed-guilds");

/**
 * Reconcile the database against the bot's actual guild membership.
 *
 * The `guildDelete` handler cleans up when the bot is removed while online, but a
 * removal that happens while the bot is offline fires no event. This daily sweep
 * catches those: any guild that still has data in the DB but that the bot is no
 * longer a member of gets the full removed-guild cleanup. The bot never leaves a
 * guild on its own — it only reconciles guilds it has already been removed from.
 */
export async function reconcileRemovedGuilds(
  client: Client,
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info("[ReconcileGuilds] Reconciling DB guilds against membership...");

  // Guard: without a ready client and a populated cache we cannot trust the
  // membership snapshot (startup / Discord outage) — skip rather than risk
  // wiping data for guilds we simply can't see yet.
  if (!client.isReady() || client.guilds.cache.size === 0) {
    logger.info(
      "[ReconcileGuilds] Client not ready or guild cache empty - skipping",
    );
    return;
  }

  const memberGuildIds = new Set(client.guilds.cache.keys());

  try {
    // Distinct serverIds that still have data across the tables cleanup removes.
    // Querying the cleaned tables (not GuildInstall) means a reconciled guild
    // stops appearing here once cleaned, so the sweep converges.
    const [players, competitions, reports, permissionErrors] =
      await Promise.all([
        db.player.findMany({
          select: { serverId: true },
          distinct: ["serverId"],
        }),
        db.competition.findMany({
          select: { serverId: true },
          distinct: ["serverId"],
        }),
        db.report.findMany({
          select: { serverId: true },
          distinct: ["serverId"],
        }),
        db.guildPermissionError.findMany({
          select: { serverId: true },
          distinct: ["serverId"],
        }),
      ]);

    const dbServerIds = new Set(
      [...players, ...competitions, ...reports, ...permissionErrors].map(
        (row) => row.serverId,
      ),
    );

    const removedServerIds = [...dbServerIds].filter(
      (serverId) => !memberGuildIds.has(serverId),
    );

    if (removedServerIds.length === 0) {
      logger.info("[ReconcileGuilds] No removed guilds with leftover data");
      return;
    }

    logger.info(
      `[ReconcileGuilds] Cleaning up ${removedServerIds.length.toString()} removed guild(s)`,
    );

    for (const serverId of removedServerIds) {
      try {
        const summary = await cleanupRemovedGuild(
          db,
          DiscordGuildIdSchema.parse(serverId),
        );
        logger.info(
          `[ReconcileGuilds] Cleaned removed guild ${serverId}: ${JSON.stringify(summary)}`,
        );
      } catch (error) {
        logger.error(
          `[ReconcileGuilds] Failed to clean removed guild ${serverId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: { source: "reconcile-removed-guild", serverId },
        });
      }
    }
  } catch (error) {
    logger.error(
      "[ReconcileGuilds] Error during reconciliation:",
      getErrorMessage(error),
    );
    Sentry.captureException(error, {
      tags: { source: "reconcile-removed-guilds" },
    });
    throw error;
  }
}
