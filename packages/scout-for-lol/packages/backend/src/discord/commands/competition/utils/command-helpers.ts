import { type ChatInputCommandInteraction } from "discord.js";
import {
  CompetitionIdSchema,
  DiscordGuildIdSchema,
  DiscordAccountIdSchema,
  type CompetitionId,
  type DiscordGuildId,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("utils-command-helpers");
import {
  replyWithErrorFromException,
  replyWithError,
  replyWithNoLinkedAccount,
} from "@scout-for-lol/backend/discord/commands/competition/utils/replies.ts";

/**
 * Extract competition ID from interaction
 */
export function extractCompetitionId(interaction: ChatInputCommandInteraction): CompetitionId {
  return CompetitionIdSchema.parse(interaction.options.getInteger("competition-id", true));
}

/**
 * Validate server context and return server ID
 * Returns null if validation fails (and sends error reply)
 */
export async function validateServerContext(interaction: ChatInputCommandInteraction): Promise<DiscordGuildId | null> {
  const serverId = interaction.guildId ? DiscordGuildIdSchema.parse(interaction.guildId) : null;

  if (!serverId) {
    await replyWithError(interaction, "This command can only be used in a server");
    return null;
  }

  return serverId;
}

/**
 * Fetch a player's linked League account for a given server and Discord user.
 * Returns null if the player record is missing or if an error occurs (after replying to the interaction).
 */
export async function fetchLinkedPlayerForUser(
  interaction: ChatInputCommandInteraction,
  serverId: DiscordGuildId,
  userId: string | DiscordAccountId,
  logContext: string,
): Promise<Awaited<ReturnType<typeof prisma.player.findFirst>> | null> {
  const parsedUserId = typeof userId === "string" ? DiscordAccountIdSchema.parse(userId) : userId;

  let player;
  try {
    player = await prisma.player.findFirst({
      where: {
        serverId,
        discordId: parsedUserId,
      },
    });
  } catch (error) {
    logger.error(`[${logContext}] Error fetching player for user ${parsedUserId}:`, error);
    await replyWithErrorFromException(interaction, error, "fetching player data");
    return null;
  }

  if (!player) {
    await replyWithNoLinkedAccount(interaction);
    return null;
  }

  return player;
}

/**
 * Fetch competition with error handling
 * Returns null if fetch fails (and sends error reply)
 */
export async function fetchCompetitionWithErrorHandling(
  interaction: ChatInputCommandInteraction,
  competitionId: number,
  commandName: string,
): Promise<Awaited<ReturnType<typeof getCompetitionById>> | null> {
  let competition;
  try {
    competition = await getCompetitionById(prisma, competitionId);
  } catch (error) {
    logger.error(`[${commandName}] Error fetching competition ${competitionId.toString()}:`, error);
    await replyWithErrorFromException(interaction, error, "fetching competition");
    return null;
  }

  if (!competition) {
    await replyWithError(interaction, `Competition with ID ${competitionId.toString()} not found`);
    return null;
  }

  return competition;
}

/**
 * Check if competition is cancelled
 * Returns true if cancelled (and sends error reply)
 */
export async function checkCompetitionCancelled(
  interaction: ChatInputCommandInteraction,
  competition: Awaited<ReturnType<typeof getCompetitionById>>,
): Promise<boolean> {
  if (!competition) {
    return true; // Already handled by fetchCompetitionWithErrorHandling
  }

  if (competition.isCancelled) {
    await replyWithError(
      interaction,
      `❌ Competition cancelled

This competition has been cancelled and is no longer accepting participants.`,
    );
    return true;
  }

  return false;
}

/**
 * Check if competition has ended
 * Returns true if ended (and sends error reply)
 */
export async function checkCompetitionEnded(
  interaction: ChatInputCommandInteraction,
  competition: Awaited<ReturnType<typeof getCompetitionById>>,
): Promise<boolean> {
  if (!competition) {
    return true; // Already handled by fetchCompetitionWithErrorHandling
  }

  const now = new Date();
  if (competition.endDate && competition.endDate < now) {
    await replyWithError(
      interaction,
      `❌ Competition ended

This competition has already ended on ${competition.endDate.toLocaleDateString()}.`,
    );
    return true;
  }

  return false;
}

/**
 * Check if competition has reached participant limit
 * Returns null if check fails (and sends error reply), otherwise returns the active participant count
 */
export async function checkParticipantLimit(options: {
  interaction: ChatInputCommandInteraction;
  competitionId: CompetitionId;
  maxParticipants: number;
  logContext: string;
  fullMessage: string;
}): Promise<number | null> {
  const { interaction, competitionId, maxParticipants, logContext, fullMessage } = options;
  let activeParticipantCount;
  try {
    activeParticipantCount = await prisma.competitionParticipant.count({
      where: {
        competitionId,
        status: { not: "LEFT" },
      },
    });
  } catch (error) {
    logger.error(`[${logContext}] Error counting participants:`, error);
    await replyWithErrorFromException(interaction, error, "checking participant limit");
    return null;
  }

  if (activeParticipantCount >= maxParticipants) {
    await replyWithError(
      interaction,
      `❌ Competition full

This competition has reached its maximum of ${maxParticipants.toString()} participants. ${fullMessage}`,
    );
    return null;
  }

  return activeParticipantCount;
}
