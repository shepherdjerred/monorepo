import { type ChatInputCommandInteraction } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  removeParticipant,
  getParticipantStatus,
} from "@scout-for-lol/backend/database/competition/participants.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-leave");
import {
  replyWithErrorFromException,
  replyWithError,
  replyWithSuccess,
} from "@scout-for-lol/backend/discord/commands/competition/utils/replies.ts";
import {
  extractCompetitionId,
  validateServerContext,
  fetchCompetitionWithErrorHandling,
  fetchLinkedPlayerForUser,
} from "@scout-for-lol/backend/discord/commands/competition/utils/command-helpers.ts";

/**
 * Execute /competition leave command
 * Allows users to opt out of competitions (soft delete - sets status to LEFT)
 */
export async function executeCompetitionLeave(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // ============================================================================
  // Step 1: Extract and validate input
  // ============================================================================

  const competitionId = extractCompetitionId(interaction);
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const serverId = await validateServerContext(interaction);
  if (!serverId) {
    return;
  }

  // ============================================================================
  // Step 2: Get user's linked Player account
  // ============================================================================

  const player = await fetchLinkedPlayerForUser(
    interaction,
    serverId,
    userId,
    "Competition Leave",
  );
  if (!player) {
    return;
  }

  // ============================================================================
  // Step 3: Check if competition exists
  // ============================================================================

  const competition = await fetchCompetitionWithErrorHandling(
    interaction,
    competitionId,
    "Competition Leave",
  );
  if (!competition) {
    return;
  }

  // ============================================================================
  // Step 4: Check if user is a participant
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
      `[Competition Leave] Error checking participant status:`,
      error,
    );
    await replyWithErrorFromException(
      interaction,
      error,
      "checking participation status",
    );
    return;
  }

  // Not a participant or already left
  if (!participantStatus || participantStatus === "LEFT") {
    await replyWithError(
      interaction,
      `❌ Not a participant

You're not in this competition. Use \`/competition list\` to see competitions you can join.`,
    );
    return;
  }

  // ============================================================================
  // Step 5: Remove participant (soft delete)
  // ============================================================================

  try {
    await removeParticipant(prisma, competitionId, player.id);
    logger.info(
      `[Competition Leave] User ${userId} left competition ${competitionId.toString()} (status was: ${participantStatus})`,
    );
  } catch (error) {
    logger.error(`[Competition Leave] Error removing participant:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "leaving competition",
    );
    return;
  }

  // ============================================================================
  // Step 6: Send success message
  // ============================================================================

  await replyWithSuccess(
    interaction,
    `✅ You've left the competition

You're no longer participating in **${competition.title}**.

Note: You cannot rejoin a competition after leaving.`,
  );
}
