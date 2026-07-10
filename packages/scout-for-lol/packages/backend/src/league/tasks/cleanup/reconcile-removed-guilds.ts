import type { Client } from "discord.js";
import * as Sentry from "@sentry/bun";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { isUnknownGuildError } from "#src/discord/utils/permissions.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-reconcile-removed-guilds");

/** Delay between the two confirmation fetches, long enough to ride out a
 * momentary per-guild blip without meaningfully delaying the daily sweep. */
const DEFAULT_VERIFY_RECHECK_DELAY_MS = 30_000;

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
 * non-removal (skips cleanup when `guild.available` is false). To match that
 * behavior here, a 10004 candidate is re-fetched once more after
 * `verifyRecheckDelayMs` — only a *second* consecutive 10004 confirms the
 * removal. A guild that comes back on the recheck was just riding out an
 * outage and is left alone.
 */
export async function reconcileRemovedGuilds(
  client: Client,
  db: ExtendedPrismaClient = prisma,
  options: { verifyRecheckDelayMs?: number } = {},
): Promise<void> {
  const verifyRecheckDelayMs =
    options.verifyRecheckDelayMs ?? DEFAULT_VERIFY_RECHECK_DELAY_MS;
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

    const candidateServerIds = [...dbServerIds].filter(
      (serverId) => !memberGuildIds.has(serverId),
    );

    const removedServerIds: string[] = [];
    for (const serverId of candidateServerIds) {
      try {
        await client.guilds.fetch(serverId);
        // Fetch succeeded: the bot is still a member, the cache was just
        // stale. Do not touch this guild's data.
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

      // First fetch came back Unknown Guild (10004). That alone can also mean
      // the guild is only temporarily unavailable (Discord outage), so wait
      // and re-fetch once more before trusting it as a real removal.
      await Bun.sleep(verifyRecheckDelayMs);
      try {
        await client.guilds.fetch(serverId);
        logger.warn(
          `[ReconcileGuilds] Guild ${serverId} returned Unknown Guild once but recovered on recheck - skipping (transient outage)`,
        );
        continue;
      } catch (error) {
        if (isUnknownGuildError(error)) {
          removedServerIds.push(serverId);
        } else {
          logger.error(
            `[ReconcileGuilds] Could not confirm removal of guild ${serverId} on recheck, skipping cleanup:`,
            getErrorMessage(error),
          );
          Sentry.captureException(error, {
            tags: {
              source: "reconcile-removed-guilds-verify-recheck",
              serverId,
            },
          });
        }
      }
    }

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
