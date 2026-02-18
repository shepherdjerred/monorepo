import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("admin-player-merge");
import {
  validateCommandArgs,
  executeWithTiming,
} from "@scout-for-lol/backend/discord/commands/admin/utils/validation.ts";

const ArgsSchema = z.object({
  sourceAlias: z.string().min(1).max(100),
  targetAlias: z.string().min(1).max(100),
  guildId: DiscordGuildIdSchema,
});

export async function executePlayerMerge(
  interaction: ChatInputCommandInteraction,
) {
  const validation = await validateCommandArgs(
    interaction,
    ArgsSchema,
    (i) => ({
      sourceAlias: i.options.getString("source-alias"),
      targetAlias: i.options.getString("target-alias"),
      guildId: i.guildId,
    }),
    "player-merge",
  );

  if (!validation.success) {
    return;
  }

  const { data: args, userId, username } = validation;
  const { sourceAlias, targetAlias, guildId } = args;

  await executeWithTiming("player-merge", username, async () => {
    // Check if trying to merge with self
    if (sourceAlias === targetAlias) {
      logger.info(`❌ Cannot merge player with itself`);
      await interaction.reply({
        content: `❌ **Invalid merge**\n\nCannot merge a player with itself.`,
        ephemeral: true,
      });
      return;
    }

    // Find source player
    const sourcePlayer = await prisma.player.findUnique({
      where: {
        serverId_alias: {
          serverId: guildId,
          alias: sourceAlias,
        },
      },
      include: {
        accounts: true,
        subscriptions: true,
        competitionParticipants: true,
      },
    });

    if (!sourcePlayer) {
      logger.info(`❌ Source player not found: "${sourceAlias}"`);
      await interaction.reply({
        content: `❌ **Source player not found**\n\nNo player with alias "${sourceAlias}" exists in this server.`,
        ephemeral: true,
      });
      return;
    }

    // Find target player
    const targetPlayer = await prisma.player.findUnique({
      where: {
        serverId_alias: {
          serverId: guildId,
          alias: targetAlias,
        },
      },
      include: {
        accounts: true,
        subscriptions: true,
        competitionParticipants: true,
      },
    });

    if (!targetPlayer) {
      logger.info(`❌ Target player not found: "${targetAlias}"`);
      await interaction.reply({
        content: `❌ **Target player not found**\n\nNo player with alias "${targetAlias}" exists in this server.`,
        ephemeral: true,
      });
      return;
    }

    logger.info(
      `💾 Merging player "${sourceAlias}" (${sourcePlayer.accounts.length.toString()} accounts, ${sourcePlayer.subscriptions.length.toString()} subscriptions) into "${targetAlias}" (${targetPlayer.accounts.length.toString()} accounts, ${targetPlayer.subscriptions.length.toString()} subscriptions)`,
    );

    try {
      const now = new Date();

      // Use a transaction to ensure all operations succeed or fail together
      await prisma.$transaction(async (tx) => {
        // 1. Move all accounts from source to target
        await tx.account.updateMany({
          where: {
            playerId: sourcePlayer.id,
          },
          data: {
            playerId: targetPlayer.id,
            updatedTime: now,
          },
        });

        logger.info(
          `✅ Moved ${sourcePlayer.accounts.length.toString()} accounts to target player`,
        );

        // 2. Handle subscriptions - keep target's subscriptions, delete source's duplicates
        // Get all unique channel IDs from both players
        const sourceChannelIds = new Set(
          sourcePlayer.subscriptions.map((sub) => sub.channelId),
        );
        const targetChannelIds = new Set(
          targetPlayer.subscriptions.map((sub) => sub.channelId),
        );

        // Delete source subscriptions (including duplicates)
        await tx.subscription.deleteMany({
          where: {
            playerId: sourcePlayer.id,
          },
        });

        logger.info(
          `✅ Removed ${sourcePlayer.subscriptions.length.toString()} subscriptions from source player`,
        );

        // Create new subscriptions for channels that were only in source
        const uniqueSourceChannels = [...sourceChannelIds].filter(
          (channelId) => !targetChannelIds.has(channelId),
        );

        if (uniqueSourceChannels.length > 0) {
          await tx.subscription.createMany({
            data: uniqueSourceChannels.map((channelId) => ({
              playerId: targetPlayer.id,
              channelId: channelId,
              serverId: guildId,
              creatorDiscordId: DiscordAccountIdSchema.parse(userId),
              createdTime: now,
              updatedTime: now,
            })),
          });

          logger.info(
            `✅ Added ${uniqueSourceChannels.length.toString()} new subscriptions to target player`,
          );
        }

        // 3. Handle competition participants
        // For each competition, if both players are participants, keep target's and delete source's
        const sourceCompetitionIds = new Set(
          sourcePlayer.competitionParticipants.map((cp) => cp.competitionId),
        );
        const targetCompetitionIds = new Set(
          targetPlayer.competitionParticipants.map((cp) => cp.competitionId),
        );

        // Delete all source competition participants
        await tx.competitionParticipant.deleteMany({
          where: {
            playerId: sourcePlayer.id,
          },
        });

        logger.info(
          `✅ Removed ${sourcePlayer.competitionParticipants.length.toString()} competition participants from source player`,
        );

        // Create new participants for competitions that were only in source
        const uniqueSourceCompetitions = [...sourceCompetitionIds].filter((competitionId) => !targetCompetitionIds.has(competitionId));

        if (uniqueSourceCompetitions.length > 0) {
          // Get the original participation data to preserve status and timestamps
          const sourceParticipations =
            sourcePlayer.competitionParticipants.filter((cp) =>
              uniqueSourceCompetitions.includes(cp.competitionId),
            );

          await tx.competitionParticipant.createMany({
            data: sourceParticipations.map((cp) => ({
              competitionId: cp.competitionId,
              playerId: targetPlayer.id,
              status: cp.status,
              invitedBy: cp.invitedBy,
              invitedAt: cp.invitedAt,
              joinedAt: cp.joinedAt,
              leftAt: cp.leftAt,
            })),
          });

          logger.info(
            `✅ Added ${uniqueSourceCompetitions.length.toString()} competition participations to target player`,
          );
        }

        // 4. Handle competition snapshots - move non-conflicting ones, delete duplicates
        // Get all snapshots from both players
        const sourceSnapshots = await tx.competitionSnapshot.findMany({
          where: { playerId: sourcePlayer.id },
          select: { id: true, competitionId: true, snapshotType: true },
        });
        const targetSnapshots = await tx.competitionSnapshot.findMany({
          where: { playerId: targetPlayer.id },
          select: { competitionId: true, snapshotType: true },
        });

        // Build a set of target's existing (competitionId, snapshotType) combinations
        const targetSnapshotKeys = new Set(
          targetSnapshots.map(
            (s) => `${s.competitionId.toString()}-${s.snapshotType}`,
          ),
        );

        // Separate source snapshots into conflicting and non-conflicting
        const conflictingIds: number[] = [];
        const nonConflictingIds: number[] = [];

        for (const snapshot of sourceSnapshots) {
          const key = `${snapshot.competitionId.toString()}-${snapshot.snapshotType}`;
          if (targetSnapshotKeys.has(key)) {
            conflictingIds.push(snapshot.id);
          } else {
            nonConflictingIds.push(snapshot.id);
          }
        }

        // Delete conflicting snapshots (target's snapshots are the canonical ones)
        if (conflictingIds.length > 0) {
          await tx.competitionSnapshot.deleteMany({
            where: { id: { in: conflictingIds } },
          });
          logger.info(
            `✅ Deleted ${conflictingIds.length.toString()} conflicting competition snapshots`,
          );
        }

        // Move non-conflicting snapshots to target player
        if (nonConflictingIds.length > 0) {
          await tx.competitionSnapshot.updateMany({
            where: { id: { in: nonConflictingIds } },
            data: { playerId: targetPlayer.id },
          });
          logger.info(
            `✅ Moved ${nonConflictingIds.length.toString()} competition snapshots to target player`,
          );
        }

        // 5. Delete the source player
        await tx.player.delete({
          where: {
            id: sourcePlayer.id,
          },
        });

        logger.info(`✅ Deleted source player "${sourceAlias}"`);

        // 6. Update target player's metadata
        await tx.player.update({
          where: {
            id: targetPlayer.id,
          },
          data: {
            updatedTime: now,
          },
        });
      });

      const totalAccounts =
        sourcePlayer.accounts.length + targetPlayer.accounts.length;
      const totalSubscriptions =
        targetPlayer.subscriptions.length +
        sourcePlayer.subscriptions.filter(
          (sourceSub) =>
            !targetPlayer.subscriptions.some(
              (targetSub) => targetSub.channelId === sourceSub.channelId,
            ),
        ).length;

      await interaction.reply({
        content: `✅ **Players merged successfully**\n\nMerged "${sourceAlias}" into "${targetAlias}"\n\n**Result:**\n• Total accounts: ${totalAccounts.toString()}\n• Total subscriptions: ${totalSubscriptions.toString()}\n• Source player "${sourceAlias}" has been deleted`,
        ephemeral: true,
      });
    } catch (error) {
      logger.error(`❌ Database error during player merge:`, error);
      await interaction.reply({
        content: `❌ **Error merging players**\n\nFailed to merge players: ${getErrorMessage(error)}\n\nNo changes were made.`,
        ephemeral: true,
      });
    }
  });
}
