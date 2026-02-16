import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import * as Sentry from "@sentry/bun";

/**
 * Build an ephemeral error reply for competition commands
 */
function buildErrorReply(content: string): InteractionReplyOptions {
  return {
    content: truncateDiscordMessage(content),
    ephemeral: true,
  };
}

/**
 * Build an ephemeral success reply for competition commands
 */
function buildSuccessReply(content: string): InteractionReplyOptions {
  return {
    content: truncateDiscordMessage(content),
    ephemeral: true,
  };
}

/**
 * Reply with an error message (ephemeral)
 */
export async function replyWithError(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply(buildErrorReply(content));
}

/**
 * Reply with a standardized "no linked account" error.
 * This is shared across competition commands that require a linked League account.
 */
export async function replyWithNoLinkedAccount(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyWithError(
    interaction,
    `❌ No League account linked

You need to link your League of Legends account first. Use:
\`/subscription add region:NA1 riot-id:YourName#NA1 alias:YourName channel:#updates\``,
  );
}

/**
 * Reply with a success message (ephemeral)
 */
export async function replyWithSuccess(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply(buildSuccessReply(content));
}

/**
 * Reply with an error from an exception (ephemeral)
 */
export async function replyWithErrorFromException(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  context: string,
): Promise<void> {
  Sentry.captureException(error, {
    tags: {
      source: "discord-command",
      context,
      userId: interaction.user.id,
      command: interaction.commandName,
    },
  });
  await interaction.reply(buildErrorReply(`Error ${context}: ${getErrorMessage(error)}`));
}
