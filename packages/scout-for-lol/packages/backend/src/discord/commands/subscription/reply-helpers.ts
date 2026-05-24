import { type ChatInputCommandInteraction } from "discord.js";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("subscription-reply");

/**
 * Send a generic failure message in response to a deferred interaction
 * when the handler itself throws (rather than returning a domain-level
 * result). Without this the user is left looking at "Scout is
 * thinking…" indefinitely.
 */
export async function editReplyOnError(
  interaction: ChatInputCommandInteraction,
  context: string,
  error: unknown,
): Promise<void> {
  logger.error(`❌ Uncaught error during ${context}`, error);
  try {
    await interaction.editReply({
      content: `❌ **Error ${context}**\n\n${getErrorMessage(error)}`,
    });
  } catch (replyError) {
    // The interaction token may have expired (15 min) or Discord may
    // have lost the reply state. Nothing we can do — log and move on.
    logger.error("❌ Failed to send error reply", replyError);
  }
}
