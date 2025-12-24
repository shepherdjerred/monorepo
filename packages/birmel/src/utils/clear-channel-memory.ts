import { getMemory, getChannelThreadId } from "../mastra/memory/index.js";
import { logger } from "./logger.js";

/**
 * Clear conversation history for a specific channel.
 * Use this when a channel's conversation history grows too large and causes token overflow.
 *
 * @param channelId - Discord channel ID to clear history for
 */
export async function clearChannelMemory(channelId: string): Promise<void> {
  const threadId = getChannelThreadId(channelId);
  logger.info(`Clearing memory for channel ${channelId} (thread: ${threadId})`);

  try {
    const memory = getMemory();

    // Delete the thread which will remove all messages
    await memory.deleteThread({ threadId });

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
    console.error("Usage: bun run src/utils/clear-channel-memory.ts <channelId>");
    process.exit(1);
  }

  clearChannelMemory(channelId)
    .then(() => {
      console.log(`Memory cleared for channel ${channelId}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed to clear memory:", error);
      process.exit(1);
    });
}
