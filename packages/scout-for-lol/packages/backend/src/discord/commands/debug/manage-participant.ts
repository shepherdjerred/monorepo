import type { ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { match } from "ts-pattern";
import {
  CompetitionIdSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import {
  addParticipant,
  removeParticipant,
  getParticipantStatus,
} from "@scout-for-lol/backend/database/competition/participants.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("debug-manage-participant");

/**
 * Execute /debug manage-participant command
 */
export async function executeDebugManageParticipant(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🐛 Executing debug manage-participant command");

  // ============================================================================
  // Step 1: Validate command options at boundary
  // ============================================================================

  const ManageParticipantOptionsSchema = z.object({
    action: z.enum(["add", "kick"]),
    competitionId: z.number().int().positive(),
    userId: z.string(),
  });

  const rawAction = interaction.options.getString("action", true);
  const rawCompetitionId = interaction.options.getInteger(
    "competition-id",
    true,
  );
  const targetUser = interaction.options.getUser("user", true);

  const optionsResult = ManageParticipantOptionsSchema.safeParse({
    action: rawAction,
    competitionId: rawCompetitionId,
    userId: targetUser.id,
  });

  if (!optionsResult.success) {
    await interaction.reply({
      content: `❌ Invalid command options: ${optionsResult.error.message}`,
      ephemeral: true,
    });
    return;
  }

  const { action, competitionId } = optionsResult.data;
  const serverId =
    interaction.guildId !== null && interaction.guildId.length > 0
      ? DiscordGuildIdSchema.parse(interaction.guildId)
      : null;

  if (!serverId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server (guild).",
      ephemeral: true,
    });
    return;
  }

  // Defer reply since this might take time
  await interaction.deferReply({ ephemeral: true });

  // ============================================================================
  // Step 2: Get competition
  // ============================================================================

  let competition;
  try {
    competition = await getCompetitionById(prisma, competitionId);
  } catch (error) {
    logger.error(
      `[Debug Manage Participant] Error fetching competition ${competitionId.toString()}:`,
      error,
    );
    await interaction.editReply(
      `❌ Error fetching competition: ${getErrorMessage(error)}`,
    );
    return;
  }

  if (!competition) {
    await interaction.editReply(
      `❌ Competition ${competitionId.toString()} not found`,
    );
    return;
  }

  // ============================================================================
  // Step 3: Get target user's linked Player account
  // ============================================================================

  let player;
  try {
    player = await prisma.player.findFirst({
      where: {
        serverId,
        discordId: DiscordAccountIdSchema.parse(targetUser.id),
      },
    });
  } catch (error) {
    logger.error(
      `[Debug Manage Participant] Error fetching player for user ${targetUser.id}:`,
      error,
    );
    await interaction.editReply(
      `❌ Error fetching player data: ${getErrorMessage(error)}`,
    );
    return;
  }

  if (!player) {
    await interaction.editReply(
      `❌ User @${targetUser.username} doesn't have a linked League of Legends account in this server.`,
    );
    return;
  }

  // ============================================================================
  // Step 4: Get current participant status
  // ============================================================================

  let participantStatus;
  try {
    participantStatus = await getParticipantStatus(
      prisma,
      competitionId,
      player.id,
    );
  } catch (error) {
    logger.error(
      `[Debug Manage Participant] Error checking participant status:`,
      error,
    );
    await interaction.editReply(
      `❌ Error checking participation status: ${getErrorMessage(error)}`,
    );
    return;
  }

  // ============================================================================
  // Step 5: Perform action using exhaustive pattern matching
  // ============================================================================

  await match(action)
    .with("add", async () => {
      // Check if already a participant
      if (participantStatus === "JOINED") {
        await interaction.editReply(
          `ℹ️ @${targetUser.username} is already a participant in **${competition.title}**.`,
        );
        return;
      }

      if (participantStatus === "INVITED") {
        await interaction.editReply(
          `ℹ️ @${targetUser.username} is already invited to **${competition.title}**. They need to accept the invitation.`,
        );
        return;
      }

      if (participantStatus === "LEFT") {
        await interaction.editReply(
          `❌ @${targetUser.username} previously left **${competition.title}** and cannot be re-added.`,
        );
        return;
      }

      // Add participant with JOINED status
      try {
        const validCompetitionId = CompetitionIdSchema.parse(competitionId);
        await addParticipant({
          prisma,
          competitionId: validCompetitionId,
          playerId: player.id,
          status: "JOINED",
        });
        logger.info(
          `[Debug Manage Participant] Added user ${targetUser.id} to competition ${competitionId.toString()}`,
        );

        // Get participant count
        const participantCount = await prisma.competitionParticipant.count({
          where: {
            competitionId: validCompetitionId,
            status: { not: "LEFT" },
          },
        });

        await interaction.editReply(
          `✅ Added @${targetUser.username} to **${competition.title}**\n` +
            `Participants: ${participantCount.toString()}/${competition.maxParticipants.toString()}`,
        );
      } catch (error) {
        logger.error(
          `[Debug Manage Participant] Error adding participant:`,
          error,
        );
        await interaction.editReply(
          `❌ Error adding participant: ${getErrorMessage(error)}`,
        );
      }
    })
    .with("kick", async () => {
      // Check if is a participant
      if (!participantStatus || participantStatus === "LEFT") {
        await interaction.editReply(
          `ℹ️ @${targetUser.username} is not a participant in **${competition.title}**.`,
        );
        return;
      }

      // Remove participant
      try {
        const validCompetitionId = CompetitionIdSchema.parse(competitionId);
        await removeParticipant(prisma, validCompetitionId, player.id);
        logger.info(
          `[Debug Manage Participant] Removed user ${targetUser.id} from competition ${competitionId.toString()}`,
        );

        // Get participant count
        const participantCount = await prisma.competitionParticipant.count({
          where: {
            competitionId: validCompetitionId,
            status: { not: "LEFT" },
          },
        });

        await interaction.editReply(
          `✅ Removed @${targetUser.username} from **${competition.title}**\n` +
            `Participants: ${participantCount.toString()}/${competition.maxParticipants.toString()}`,
        );
      } catch (error) {
        logger.error(
          `[Debug Manage Participant] Error removing participant:`,
          error,
        );
        await interaction.editReply(
          `❌ Error removing participant: ${getErrorMessage(error)}`,
        );
      }
    })
    .exhaustive();
}
