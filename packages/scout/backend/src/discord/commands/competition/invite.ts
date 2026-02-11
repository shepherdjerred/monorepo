import { type ChatInputCommandInteraction } from "discord.js";
import { DiscordAccountIdSchema } from "@shepherdjerred/scout-data";
import { prisma } from "@shepherdjerred/scout-backend/database/index.ts";
import { addParticipant, getParticipantStatus } from "@shepherdjerred/scout-backend/database/competition/participants.ts";
import { formatCriteriaType } from "@shepherdjerred/scout-backend/discord/commands/competition/helpers.ts";
import {
  replyWithError,
  replyWithErrorFromException,
  replyWithSuccess,
} from "@shepherdjerred/scout-backend/discord/commands/competition/utils/replies.ts";
import {
  extractCompetitionId,
  validateServerContext,
  fetchCompetitionWithErrorHandling,
  checkCompetitionCancelled,
  checkCompetitionEnded,
  checkParticipantLimit,
} from "@shepherdjerred/scout-backend/discord/commands/competition/utils/command-helpers.ts";
import { truncateDiscordMessage } from "@shepherdjerred/scout-backend/discord/utils/message.ts";
import { getErrorMessage } from "@shepherdjerred/scout-backend/utils/errors.ts";
import type { CompetitionId } from "@shepherdjerred/scout-data";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("competition-invite");

/**
 * Handle existing participant status
 * Returns true if status was handled (and function should return), false otherwise
 */
async function handleExistingParticipantStatus(
  interaction: ChatInputCommandInteraction,
  participantStatus: "JOINED" | "INVITED" | "LEFT" | null,
  username: string,
  competitionId: CompetitionId,
): Promise<boolean> {
  if (participantStatus === "JOINED") {
    await replyWithError(
      interaction,
      `❌ Already participating

@${username} is already in this competition.`,
    );
    return true;
  }

  if (participantStatus === "INVITED") {
    // Idempotent - already invited, just acknowledge
    await replyWithSuccess(
      interaction,
      `@${username} has already been invited to this competition. They can join with:
\`/competition join competition-id:${competitionId.toString()}\``,
    );
    return true;
  }

  if (participantStatus === "LEFT") {
    await replyWithError(
      interaction,
      `❌ Cannot invite

@${username} previously left this competition and cannot be re-invited.`,
    );
    return true;
  }

  return false;
}

/**
 * Execute /competition invite command
 * Allows competition owners to invite specific users to their competitions
 */
export async function executeCompetitionInvite(interaction: ChatInputCommandInteraction): Promise<void> {
  // ============================================================================
  // Step 1: Extract and validate input
  // ============================================================================

  const competitionId = extractCompetitionId(interaction);
  const targetUser = interaction.options.getUser("user", true);
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const serverId = await validateServerContext(interaction);
  if (!serverId) {
    return;
  }

  // ============================================================================
  // Step 2: Check if competition exists
  // ============================================================================

  const competition = await fetchCompetitionWithErrorHandling(interaction, competitionId, "Competition Invite");
  if (!competition) {
    return;
  }

  // ============================================================================
  // Step 3: Check ownership
  // ============================================================================

  if (competition.ownerId !== userId) {
    await replyWithError(
      interaction,
      `❌ Permission denied

Only the competition owner can invite participants. The owner of this competition is <@${competition.ownerId}>.`,
    );
    return;
  }

  // ============================================================================
  // Step 4: Check if competition is cancelled
  // ============================================================================

  if (await checkCompetitionCancelled(interaction, competition)) {
    return;
  }

  // ============================================================================
  // Step 5: Check if competition has ended
  // ============================================================================

  if (await checkCompetitionEnded(interaction, competition)) {
    return;
  }

  // ============================================================================
  // Step 6: Get target user's linked Player account
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
    logger.error(`[Competition Invite] Error fetching player for user ${targetUser.id}:`, error);
    await replyWithErrorFromException(interaction, error, "fetching player data");
    return;
  }

  if (!player) {
    await replyWithError(
      interaction,
      `❌ Cannot invite user

@${targetUser.username} doesn't have a linked League of Legends account. They need to use \`/subscription add\` first.`,
    );
    return;
  }

  // ============================================================================
  // Step 7: Check existing participant status
  // ============================================================================

  let participantStatus;
  try {
    participantStatus = await getParticipantStatus(prisma, competitionId, player.id);
  } catch (error) {
    logger.error(`[Competition Invite] Error checking participant status:`, error);
    await replyWithErrorFromException(interaction, error, "checking participation status");
    return;
  }

  // Handle existing participant statuses
  const statusHandled = await handleExistingParticipantStatus(
    interaction,
    participantStatus,
    targetUser.username,
    competitionId,
  );
  if (statusHandled) {
    return;
  }

  // ============================================================================
  // Step 8: Check participant limit
  // ============================================================================

  const activeParticipantCount = await checkParticipantLimit({
    interaction,
    competitionId,
    maxParticipants: competition.maxParticipants,
    logContext: "Competition Invite",
    fullMessage: "Cannot invite more users.",
  });
  if (activeParticipantCount === null) {
    return;
  }

  // ============================================================================
  // Step 9: Add participant with INVITED status
  // ============================================================================

  try {
    await addParticipant({
      prisma,
      competitionId,
      playerId: player.id,
      status: "INVITED",
      invitedBy: userId,
    });
    logger.info(
      `[Competition Invite] User ${userId} invited ${targetUser.id} to competition ${competitionId.toString()}`,
    );
  } catch (error) {
    logger.error(`[Competition Invite] Error adding participant:`, error);
    await replyWithErrorFromException(interaction, error, "sending invitation");
    return;
  }

  // ============================================================================
  // Step 10: Send DM to invited user
  // ============================================================================

  let dmFailed = false;
  try {
    const startDateStr = competition.startDate
      ? competition.startDate.toLocaleDateString()
      : competition.seasonId
        ? `Season ${competition.seasonId}`
        : "TBD";
    const endDateStr = competition.endDate ? competition.endDate.toLocaleDateString() : "TBD";
    const duration = competition.startDate && competition.endDate ? `${startDateStr} - ${endDateStr}` : startDateStr;

    await targetUser.send({
      content: truncateDiscordMessage(`📩 **Competition Invitation**

You've been invited to compete in **${competition.title}**!

**Description:** ${competition.description}
**Type:** ${formatCriteriaType(competition.criteria.type)}
**Duration:** ${duration}
**Owner:** <@${competition.ownerId}>

To join, use:
\`/competition join competition-id:${competitionId.toString()}\``),
    });
    logger.info(`[Competition Invite] DM sent to user ${targetUser.id}`);
  } catch (error) {
    logger.warn(`[Competition Invite] Failed to DM user ${targetUser.id}:`, getErrorMessage(error));
    dmFailed = true;
  }

  // ============================================================================
  // Step 11: Send success message
  // ============================================================================

  const dmWarning = dmFailed
    ? "\n⚠️ Note: Could not send DM (user may have DMs disabled). Please notify them manually."
    : "";

  await replyWithSuccess(
    interaction,
    `✅ Invitation sent

Invited @${targetUser.username} to **${competition.title}**.
They can join with \`/competition join competition-id:${competitionId.toString()}\`${dmWarning}`,
  );
}
