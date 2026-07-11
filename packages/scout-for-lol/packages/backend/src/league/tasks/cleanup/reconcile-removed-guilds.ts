import type { Client } from "discord.js";
import * as Sentry from "@sentry/bun";
import {
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { isUnknownGuildError } from "#src/discord/utils/permissions.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-reconcile-removed-guilds");

/**
 * Minimum elapsed time since `firstDetectedAt` before a repeat 10004 counts
 * as confirmed removal. A calendar-date comparison alone is not enough: an
 * outage detected at 23:55 UTC and rechecked at 00:05 UTC the next day spans
 * two calendar dates but is only 10 minutes long, well within normal outage
 * duration. Requiring a full day of elapsed wall-clock time closes that gap.
 */
const CONFIRMATION_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reconcile the database against the bot's actual guild membership.
 *
 * The `guildDelete` handler cleans up when the bot is removed while online, but a
 * removal that happens while the bot is offline fires no event. This daily sweep
 * catches those: any guild that still has data in the DB but that the bot is no
 * longer a member of gets the full removed-guild cleanup. The bot never leaves a
 * guild on its own — it only reconciles guilds it has already been removed from.
 *
 * A guild missing from `client.guilds.cache` is only a *candidate* for cleanup,
 * not proof of removal — the cache can lag behind actual membership (a
 * reconnect, or the `runOnInit` run racing Discord's guild backfill). Each
 * candidate is confirmed with a live `guilds.fetch` before anything is
 * deleted: only a Discord-confirmed "Unknown Guild" (10004) response counts as
 * a real removal. Any other outcome (fetch succeeds, or fails for an
 * unrelated reason) skips cleanup for that guild rather than risk wiping live
 * data on a stale cache read. (Incident 2026-07: this reconciler treated its
 * own home guild as removed on a cache miss and repeatedly deleted + re-seeded
 * the COMMON_DENOMINATOR system reports, so `ScoutScheduledReportMissedWeekly`
 * fired forever — see packages/docs/logs/2026-07-09_scout-pd-alert.md.)
 *
 * A single 10004 is still not fully trusted: a guild that is merely
 * *temporarily unavailable* (Discord region/shard outage) can also 404 on a
 * REST fetch, and the `guildDelete` event handler already treats that case as
 * non-removal (skips cleanup when `guild.available` is false) - and an outage
 * can easily outlast any in-process retry delay. Instead, confirmation is
 * tracked across *time* in `GuildRemovalCandidate`: the first run to see a
 * 10004 just records the sighting and skips cleanup; a guild is only cleaned
 * up once a run at least `CONFIRMATION_DELAY_MS` after `firstDetectedAt` also
 * sees 10004. A plain calendar-date comparison isn't enough here - an outage
 * detected at 23:55 UTC and rechecked at 00:05 UTC the next day spans two
 * dates but is only 10 minutes long, so this uses elapsed wall-clock time
 * instead. A guild that comes back reachable on any run clears its candidate
 * row and is left alone.
 */
export async function reconcileRemovedGuilds(
  client: Client,
  db: ExtendedPrismaClient = prisma,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
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
  const nowMs = now.getTime();

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

    const candidateServerIds = [...dbServerIds].filter(
      (serverId) => !memberGuildIds.has(serverId),
    );

    const removedGuildIds: DiscordGuildId[] = [];
    for (const serverId of candidateServerIds) {
      const guildId = DiscordGuildIdSchema.parse(serverId);
      try {
        await client.guilds.fetch(serverId);
        // Fetch succeeded: the bot is still a member, the cache was just
        // stale. Do not touch this guild's data, and forget any prior
        // sighting - it was a false alarm.
        await db.guildRemovalCandidate.deleteMany({
          where: { serverId: guildId },
        });
        logger.warn(
          `[ReconcileGuilds] Guild ${serverId} missing from cache but confirmed still a member via API - skipping (stale cache)`,
        );
        continue;
      } catch (error) {
        if (!isUnknownGuildError(error)) {
          logger.error(
            `[ReconcileGuilds] Could not confirm removal of guild ${serverId}, skipping cleanup:`,
            getErrorMessage(error),
          );
          Sentry.captureException(error, {
            tags: { source: "reconcile-removed-guilds-verify", serverId },
          });
          continue;
        }
      }

      // Fetch came back Unknown Guild (10004). That alone can also mean the
      // guild is only temporarily unavailable (Discord outage), so this only
      // counts as confirmed once a run on a LATER UTC day also sees 10004.
      const existing = await db.guildRemovalCandidate.findUnique({
        where: { serverId: guildId },
      });
      if (existing === null) {
        await db.guildRemovalCandidate.create({
          data: { serverId: guildId, firstDetectedAt: now, lastCheckedAt: now },
        });
        logger.warn(
          `[ReconcileGuilds] Guild ${serverId} returned Unknown Guild for the first time - waiting for a later day's run to confirm before cleanup`,
        );
        continue;
      }

      const elapsedMs = nowMs - existing.firstDetectedAt.getTime();
      if (elapsedMs < CONFIRMATION_DELAY_MS) {
        await db.guildRemovalCandidate.update({
          where: { serverId: guildId },
          data: { lastCheckedAt: now },
        });
        logger.warn(
          `[ReconcileGuilds] Guild ${serverId} returned Unknown Guild again too soon after first sighting (${elapsedMs.toString()}ms) - waiting for ${CONFIRMATION_DELAY_MS.toString()}ms to elapse before confirming cleanup`,
        );
        continue;
      }

      removedGuildIds.push(guildId);
    }

    if (removedGuildIds.length === 0) {
      logger.info("[ReconcileGuilds] No removed guilds with leftover data");
      return;
    }

    logger.info(
      `[ReconcileGuilds] Cleaning up ${removedGuildIds.length.toString()} removed guild(s)`,
    );

    for (const guildId of removedGuildIds) {
      try {
        const summary = await cleanupRemovedGuild(db, guildId);
        await db.guildRemovalCandidate.deleteMany({
          where: { serverId: guildId },
        });
        logger.info(
          `[ReconcileGuilds] Cleaned removed guild ${guildId}: ${JSON.stringify(summary)}`,
        );
      } catch (error) {
        logger.error(
          `[ReconcileGuilds] Failed to clean removed guild ${guildId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: { source: "reconcile-removed-guild", serverId: guildId },
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
