import {
  getMemory,
  getChannelConversationId,
} from "../voltagent/memory/index.js";
import { logger } from "./logger.js";

/**
 * Clear conversation history for a specific channel.
 * Use this when a channel's conversation history grows too large and causes token overflow.
 *
 * @param channelId - Discord channel ID to clear history for
 */
export async function clearChannelMemory(channelId: string): Promise<void> {
  const conversationId = getChannelConversationId(channelId);
  logger.info(
    `Clearing memory for channel ${channelId} (conversation: ${conversationId})`,
  );

  try {
    const memory = getMemory();

    // Clear all messages for this conversation
    // The userId is required by the API but not used for channel-level clearing
    await memory.clearMessages("system", conversationId);

    logger.info(`Successfully cleared memory for channel ${channelId}`);
  } catch (error) {
    logger.error(`Failed to clear memory for channel ${channelId}`, error);
    throw error;
  }
}

/**
 * CLI usage: bun run src/utils/clear-channel-memory.ts <channelId>
 */
if (import.meta.main) {
  const channelId = process.argv[2];

  if (!channelId) {
    console.error(
      "Usage: bun run src/utils/clear-channel-memory.ts <channelId>",
    );
    process.exit(1);
  }

  clearChannelMemory(channelId)
    .then(() => {
      console.log(`Memory cleared for channel ${channelId}`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Failed to clear memory:", error);
      process.exit(1);
    });
}
