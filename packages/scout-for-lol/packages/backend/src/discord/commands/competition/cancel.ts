import { type ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { cancelCompetition } from "@scout-for-lol/backend/database/competition/queries.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { asTextChannel } from "@scout-for-lol/backend/discord/utils/channel.ts";
import {
  extractCompetitionId,
  fetchCompetitionWithErrorHandling,
} from "@scout-for-lol/backend/discord/commands/competition/utils/command-helpers.ts";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-cancel");

/**
 * Execute /competition cancel command
 * Allows owner or server admin to cancel a competition
 */
export async function executeCompetitionCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  // ============================================================================
  // Step 1: Extract and validate input
  // ============================================================================

  const competitionId = extractCompetitionId(interaction);
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);

  // ============================================================================
  // Step 2: Check if competition exists
  // ============================================================================

  const competition = await fetchCompetitionWithErrorHandling(interaction, competitionId, "Competition Cancel");
  if (!competition) {
    return;
  }

  // ============================================================================
  // Step 3: Check permissions (owner or admin)
  // ============================================================================

  const member = interaction.member;
  const isOwner = competition.ownerId === userId;

  // Check if user is admin (only works in guild context)
  const isAdmin =
    member && typeof member.permissions !== "string" && member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isOwner && !isAdmin) {
    await interaction.reply({
      content: truncateDiscordMessage("Only the competition owner or server administrators can cancel competitions"),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 4: Cancel the competition
  // ============================================================================

  try {
    await cancelCompetition(prisma, competitionId);
    logger.info(`[Competition Cancel] Competition ${competitionId.toString()} cancelled by user ${userId}`);
  } catch (error) {
    logger.error(`[Competition Cancel] Error cancelling competition ${competitionId.toString()}:`, error);
    await interaction.reply({
      content: truncateDiscordMessage(`Error cancelling competition: ${getErrorMessage(error)}`),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 5: Send success message
  // ============================================================================

  await interaction.reply({
    content: truncateDiscordMessage(`Competition "${competition.title}" has been cancelled`),
    ephemeral: true,
  });

  // ============================================================================
  // Step 6: Post notification to competition channel
  // ============================================================================

  try {
    const channel = await interaction.client.channels.fetch(competition.channelId);

    if (!channel) {
      logger.warn(`[Competition Cancel] Channel ${competition.channelId} not found`);
      return;
    }

    const textChannel = asTextChannel(channel);

    if (!textChannel) {
      logger.warn(`[Competition Cancel] Channel ${competition.channelId} is not text-based`);
      return;
    }

    await textChannel.send(`🚫 Competition **${competition.title}** has been cancelled by <@${userId}>`);
    logger.info(`[Competition Cancel] Posted notification to channel ${competition.channelId}`);
  } catch (error) {
    // Non-critical error - log but don't fail the command
    // Permission errors are expected and shouldn't be alarming
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes("permission") || errorMessage.includes("50013") || errorMessage.includes("50001")) {
      logger.warn(
        `[Competition Cancel] Cannot post to channel ${competition.channelId} - missing permissions. ` +
          "Please ensure the bot has 'Send Messages' and 'View Channel' permissions.",
      );
    } else {
      logger.error(`[Competition Cancel] Error posting to channel ${competition.channelId}:`, errorMessage);
    }
  }
}
