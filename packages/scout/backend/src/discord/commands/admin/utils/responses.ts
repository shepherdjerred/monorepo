import type { InteractionReplyOptions } from "discord.js";
import { getErrorMessage } from "@shepherdjerred/scout-backend/utils/errors.ts";

/**
 * Build a player not found error response
 */
export function buildPlayerNotFoundError(alias: string): InteractionReplyOptions {
  return {
    content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
    ephemeral: true,
  };
}

/**
 * Build a database error response
 */
export function buildDatabaseError(operation: string, error: unknown): InteractionReplyOptions {
  const errorMessage = getErrorMessage(error);
  return {
    content: `❌ **Database Error**\n\nFailed to ${operation}: ${errorMessage}`,
    ephemeral: true,
  };
}

/**
 * Build a Riot API error response
 */
export function buildRiotApiError(_riotId: string, error: string): InteractionReplyOptions {
  return {
    content: `❌ **Error looking up Riot ID**\n\n${error}`,
    ephemeral: true,
  };
}

/**
 * Build a success response with optional details
 */
export function buildSuccessResponse(message: string, details?: string): InteractionReplyOptions {
  const content = details ? `${message}\n\n${details}` : message;
  return {
    content,
    ephemeral: true,
  };
}

/**
 * Build an account already exists error
 */
export function buildAccountExistsError(
  riotId: string,
  existingPlayerAlias: string,
  targetPlayerAlias: string,
): InteractionReplyOptions {
  const isSamePlayer = existingPlayerAlias === targetPlayerAlias;
  const additionalInfo = isSamePlayer
    ? "This account is already on this player."
    : `If you want to move it to "${targetPlayerAlias}", use \`/admin account-transfer\` instead.`;

  return {
    content: `❌ **Account already exists**\n\nThe account ${riotId} is already registered to player "${existingPlayerAlias}".\n\n${additionalInfo}`,
    ephemeral: true,
  };
}

/**
 * Build a player already has Discord linked error
 */
export function buildDiscordAlreadyLinkedError(
  playerAlias: string,
  existingDiscordId: string,
): InteractionReplyOptions {
  return {
    content: `❌ **Discord ID already linked**\n\nPlayer "${playerAlias}" is already linked to Discord user <@${existingDiscordId}>.\n\nUse \`/admin player-unlink-discord\` first if you want to change the link.`,
    ephemeral: true,
  };
}

/**
 * Build a Discord ID already in use error
 */
export function buildDiscordIdInUseError(discordId: string, existingPlayerAlias: string): InteractionReplyOptions {
  return {
    content: `❌ **Discord ID already in use**\n\n<@${discordId}> is already linked to player "${existingPlayerAlias}".\n\nUse \`/admin player-unlink-discord\` on "${existingPlayerAlias}" first if you want to link this Discord account to a different player.`,
    ephemeral: true,
  };
}

/**
 * Build a player not linked to Discord error
 */
export function buildPlayerNotLinkedError(alias: string): InteractionReplyOptions {
  return {
    content: `❌ **No Discord link**\n\nPlayer "${alias}" does not have a Discord account linked.`,
    ephemeral: true,
  };
}
