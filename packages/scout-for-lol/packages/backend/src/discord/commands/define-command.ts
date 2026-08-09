import type { ChatInputCommandInteraction } from "discord.js";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-command-errors");

export type CommandReply = (
  ...args: Parameters<ChatInputCommandInteraction["reply"]>
) => Promise<unknown>;
export type CommandEditReply = (
  ...args: Parameters<ChatInputCommandInteraction["editReply"]>
) => Promise<unknown>;
export type CommandErrorInteraction = {
  replied: boolean;
  deferred: boolean;
  reply: CommandReply;
  editReply: CommandEditReply;
};

/** Reply to a retained Discord command with a uniform ephemeral error. */
export async function replyError(
  interaction: CommandErrorInteraction,
  context: string,
  error: unknown,
): Promise<void> {
  logger.error(`❌ Uncaught error during ${context}`, error);
  const content = `❌ **Error ${context}**\n\n${getErrorMessage(error)}`;
  try {
    await (interaction.replied || interaction.deferred
      ? interaction.editReply({ content })
      : interaction.reply({ content, ephemeral: true }));
  } catch (sendError) {
    logger.error("❌ Failed to send error reply", sendError);
  }
}
