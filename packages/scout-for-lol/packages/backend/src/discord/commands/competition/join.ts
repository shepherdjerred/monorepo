import { type ChatInputCommandInteraction } from "discord.js";
import {
  DiscordAccountIdSchema,
  getCompetitionStatus,
} from "@scout-for-lol/data";
import { match } from "ts-pattern";
import { differenceInCalendarDays } from "date-fns";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  addParticipant,
  acceptInvitation,
  getParticipantStatus,
} from "@scout-for-lol/backend/database/competition/participants.ts";
import { formatCriteriaType } from "@scout-for-lol/backend/discord/commands/competition/helpers.ts";
import {
  replyWithErrorFromException,
  replyWithError,
} from "@scout-for-lol/backend/discord/commands/competition/utils/replies.ts";
import {
  extractCompetitionId,
  validateServerContext,
  fetchCompetitionWithErrorHandling,
  checkCompetitionCancelled,
  checkCompetitionEnded,
  checkParticipantLimit,
} from "@scout-for-lol/backend/discord/commands/competition/utils/command-helpers.ts";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-join");

/**
 * Execute /competition join command
 * Allows users to opt into OPEN competitions or accept invitations to INVITE_ONLY competitions
 */
export async function executeCompetitionJoin(
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

  let player;
  try {
    player = await prisma.player.findFirst({
      where: {
        serverId,
        discordId: userId,
      },
    });
  } catch (error) {
    logger.error(
      `[Competition Join] Error fetching player for user ${userId}:`,
      error,
    );
    await replyWithErrorFromException(
      interaction,
      error,
      "fetching player data",
    );
    return;
  }

  if (!player) {
    await replyWithError(
      interaction,
      `❌ No League account linked

You need to link your League of Legends account first. Use:
\`/subscription add region:NA1 riot-id:YourName#NA1 alias:YourName channel:#updates\``,
    );
    return;
  }

  // ============================================================================
  // Step 3: Check if competition exists
  // ============================================================================

  const competition = await fetchCompetitionWithErrorHandling(
    interaction,
    competitionId,
    "Competition Join",
  );
  if (!competition) {
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

  const now = new Date();
  if (await checkCompetitionEnded(interaction, competition)) {
    return;
  }

  // ============================================================================
  // Step 6: Check existing participant status
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
      `[Competition Join] Error checking participant status:`,
      error,
    );
    await replyWithErrorFromException(
      interaction,
      error,
      "checking participation status",
    );
    return;
  }

  // Handle existing participant statuses
  if (participantStatus === "JOINED") {
    await replyWithError(
      interaction,
      `❌ Already participating

You're already in this competition! Check your current standing with:
\`/competition view competition-id:${competitionId.toString()}\``,
    );
    return;
  }

  if (participantStatus === "LEFT") {
    await replyWithError(
      interaction,
      `❌ Cannot rejoin

You previously left this competition and cannot rejoin.`,
    );
    return;
  }

  // ============================================================================
  // Step 7: Check visibility and permissions
  // ============================================================================

  // If INVITE_ONLY, user must have an invitation
  if (
    competition.visibility === "INVITE_ONLY" &&
    participantStatus !== "INVITED"
  ) {
    await replyWithError(
      interaction,
      `❌ Invitation required

This is an invite-only competition. Ask the competition owner (<@${competition.ownerId}>) to invite you with:
\`/competition invite competition-id:${competitionId.toString()} user:@${interaction.user.username}\``,
    );
    return;
  }

  // ============================================================================
  // Step 8: Check participant limit
  // ============================================================================

  const activeParticipantCount = await checkParticipantLimit({
    interaction,
    competitionId,
    maxParticipants: competition.maxParticipants,
    logContext: "Competition Join",
    fullMessage: "The competition is full!",
  });
  if (activeParticipantCount === null) {
    return;
  }

  // ============================================================================
  // Step 9: Add participant or accept invitation
  // ============================================================================

  try {
    // At this point, participantStatus can only be "INVITED" or null
    // ("JOINED" and "LEFT" are handled earlier)
    await match(participantStatus)
      .with("INVITED", async () => {
        // User was invited, accept the invitation
        await acceptInvitation(prisma, competitionId, player.id);
        logger.info(
          `[Competition Join] User ${userId} accepted invitation to competition ${competitionId.toString()}`,
        );
      })
      .with(null, async () => {
        // User is joining for the first time (OPEN or SERVER_WIDE)
        await addParticipant({
          prisma,
          competitionId,
          playerId: player.id,
          status: "JOINED",
        });
        logger.info(
          `[Competition Join] User ${userId} joined competition ${competitionId.toString()}`,
        );
      })
      .exhaustive();
  } catch (error) {
    logger.error(`[Competition Join] Error adding participant:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "joining competition",
    );
    return;
  }

  // ============================================================================
  // Step 10: Get updated participant count
  // ============================================================================

  let updatedParticipantCount;
  try {
    updatedParticipantCount = await prisma.competitionParticipant.count({
      where: {
        competitionId,
        status: { not: "LEFT" },
      },
    });
  } catch (error) {
    logger.error(
      `[Competition Join] Error counting updated participants:`,
      error,
    );
    updatedParticipantCount = activeParticipantCount + 1;
  }

  // ============================================================================
  // Step 11: Send success message
  // ============================================================================

  const status = getCompetitionStatus(competition);
  const statusLine = formatStatusForJoinMessage(status, competition, now);

  await interaction.reply({
    content: truncateDiscordMessage(`✅ You've joined the competition!

**${competition.title}**
Type: ${formatCriteriaType(competition.criteria.type)}
Participants: ${updatedParticipantCount.toString()}/${competition.maxParticipants.toString()}
${statusLine}

Good luck! The leaderboard will be posted daily in <#${competition.channelId}>.`),
    ephemeral: true,
  });
}

/**
 * Format status for join success message
 */
function formatStatusForJoinMessage(
  status: ReturnType<typeof getCompetitionStatus>,
  competition: { startDate: Date | null; endDate: Date | null },
  now: Date,
): string {
  switch (status) {
    case "DRAFT":
      if (competition.startDate && competition.startDate > now) {
        return `Status: Starting ${getRelativeTimeString(competition.startDate)}`;
      }
      return "Status: Draft";
    case "ACTIVE":
      return "Status: In progress";
    case "ENDED":
      return "Status: Ended";
    case "CANCELLED":
      return "Status: Cancelled";
  }
}

/**
 * Get relative time string (e.g., "in 2 days")
 */
function getRelativeTimeString(date: Date): string {
  const now = new Date();
  const diffDays = differenceInCalendarDays(date, now);

  if (diffDays > 0) {
    return `in ${diffDays.toString()} day${diffDays === 1 ? "" : "s"}`;
  }
  if (diffDays === 0) {
    return "today";
  }
  return "soon";
}
