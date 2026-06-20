/**
 * Removed-guild cleanup.
 *
 * When the bot is removed from a guild (kicked, left, or confirmed gone), all
 * of that guild's operational data must be deleted so the bot stops generating
 * reports for, polling, and erroring on a server it can no longer reach.
 *
 * Triggered reactively by the `guildDelete` event handler and by the abandoned
 * guild sweep when a guild is no longer fetchable. Idempotent: running it again
 * for an already-clean guild deletes nothing and returns all-zero counts.
 */

import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { guildDataCleanupTotal } from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-removed-guild");

export type RemovedGuildCleanupSummary = {
  competitions: number;
  reports: number;
  subscriptions: number;
  serverPermissions: number;
  accounts: number;
  players: number;
  permissionErrors: number;
};

/**
 * Delete all data for a guild the bot has been removed from.
 *
 * Runs in a single transaction in FK-safe order. Deleting a `Competition`
 * cascades its `CompetitionParticipant` / `CompetitionSnapshot` rows, and
 * deleting a `Report` cascades its `ReportRun` rows. Any residual participant /
 * snapshot rows for this guild's players (e.g. cross-server invites) are deleted
 * explicitly before the players themselves so the `Player` delete cannot fail
 * on a foreign key.
 */
export async function cleanupRemovedGuild(
  db: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<RemovedGuildCleanupSummary> {
  logger.info(`[RemoveGuild] Cleaning up all data for guild ${serverId}`);

  const summary = await db.$transaction(
    async (tx): Promise<RemovedGuildCleanupSummary> => {
      const playerRows = await tx.player.findMany({
        where: { serverId },
        select: { id: true },
      });
      const playerIds = playerRows.map((player) => player.id);

      // Competitions first: cascades participants + snapshots for this guild's
      // own competitions, and stops system reports from being recreated.
      const competitions = await tx.competition.deleteMany({
        where: { serverId },
      });

      // Defensive: remove any participant/snapshot rows still pointing at this
      // guild's players (covers a player invited to another guild's competition).
      if (playerIds.length > 0) {
        await tx.competitionParticipant.deleteMany({
          where: { playerId: { in: playerIds } },
        });
        await tx.competitionSnapshot.deleteMany({
          where: { playerId: { in: playerIds } },
        });
      }

      const reports = await tx.report.deleteMany({ where: { serverId } });
      const subscriptions = await tx.subscription.deleteMany({
        where: { serverId },
      });
      const serverPermissions = await tx.serverPermission.deleteMany({
        where: { serverId },
      });
      const accounts = await tx.account.deleteMany({ where: { serverId } });
      const players = await tx.player.deleteMany({ where: { serverId } });
      const permissionErrors = await tx.guildPermissionError.deleteMany({
        where: { serverId },
      });

      return {
        competitions: competitions.count,
        reports: reports.count,
        subscriptions: subscriptions.count,
        serverPermissions: serverPermissions.count,
        accounts: accounts.count,
        players: players.count,
        permissionErrors: permissionErrors.count,
      };
    },
  );

  logger.info(
    `[RemoveGuild] ✅ Cleaned guild ${serverId}: ${JSON.stringify(summary)}`,
  );
  for (const [dataType, count] of Object.entries(summary)) {
    guildDataCleanupTotal.inc(
      { data_type: dataType, status: "success" },
      count,
    );
  }

  return summary;
}
