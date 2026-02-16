import {
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  MessageFlags,
} from "discord.js";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "@scout-for-lol/backend/database/index.ts";
import type { PlayerWithSubscriptions } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("utils-discord-link-helpers");
import {
  buildDiscordAlreadyLinkedError,
  buildDiscordIdInUseError,
  buildPlayerNotLinkedError,
} from "@scout-for-lol/backend/discord/commands/admin/utils/responses.ts";

/**
 * Validation result for Discord link operations
 */
type DiscordLinkValidationResult =
  | { success: true }
  | { success: false; errorResponse: { content: string; flags?: number } };

/**
 * Build a validation error response for player not found
 */
function buildPlayerNotFoundError(
  playerAlias: string,
): DiscordLinkValidationResult {
  return {
    success: false,
    errorResponse: {
      content: `❌ Player "${playerAlias}" not found`,
      flags: MessageFlags.Ephemeral,
    },
  };
}

/**
 * Build a validation error response from an error response builder function
 */
function buildValidationErrorResponse(
  errorResponse: InteractionReplyOptions,
): DiscordLinkValidationResult {
  return {
    success: false,
    errorResponse: {
      content: errorResponse.content ?? "",
      flags: MessageFlags.Ephemeral,
    },
  };
}

/**
 * Validate that a Discord ID can be linked to a player
 * Checks:
 * 1. Discord ID is not already linked to a different player
 * 2. Player doesn't already have a Discord ID
 */
export async function validateDiscordLink(options: {
  prisma: ExtendedPrismaClient;
  guildId: DiscordGuildId;
  player: PlayerWithSubscriptions;
  discordUserId: DiscordAccountId;
  playerAlias: string;
}): Promise<DiscordLinkValidationResult> {
  const { prisma, guildId, player, discordUserId, playerAlias } = options;
  if (!player) {
    return buildPlayerNotFoundError(playerAlias);
  }

  // Check if this Discord ID is already linked to a different player
  const existingPlayer = await prisma.player.findFirst({
    where: {
      serverId: guildId,
      discordId: discordUserId,
      NOT: {
        id: player.id,
      },
    },
  });

  if (existingPlayer) {
    logger.info(
      `❌ Discord ID already linked to player "${existingPlayer.alias}"`,
    );
    return buildValidationErrorResponse(
      buildDiscordIdInUseError(discordUserId, existingPlayer.alias),
    );
  }

  // Check if player already has a Discord ID
  if (player.discordId) {
    logger.info(`⚠️  Player already has Discord ID: ${player.discordId}`);
    return buildValidationErrorResponse(
      buildDiscordAlreadyLinkedError(playerAlias, player.discordId),
    );
  }

  return { success: true };
}

/**
 * Validate that a Discord ID can be unlinked from a player
 * Checks:
 * 1. Player has a Discord ID to unlink
 */
export function validateDiscordUnlink(
  player: PlayerWithSubscriptions,
  playerAlias: string,
): DiscordLinkValidationResult {
  if (!player) {
    return buildPlayerNotFoundError(playerAlias);
  }

  if (!player.discordId) {
    logger.info(`⚠️  Player has no Discord ID to unlink`);
    return buildValidationErrorResponse(buildPlayerNotLinkedError(playerAlias));
  }

  return { success: true };
}

/**
 * Execute a Discord link operation with common error handling
 */
export async function executeDiscordLinkOperation(
  interaction: ChatInputCommandInteraction,
  operation: () => Promise<void>,
  operationName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    logger.error(`❌ Database error during Discord ${operationName}:`, error);
    const { buildDatabaseError } =
      await import("@scout-for-lol/backend/discord/commands/admin/utils/responses.js");
    await interaction.reply(
      buildDatabaseError(`${operationName} Discord ID`, error),
    );
  }
}
