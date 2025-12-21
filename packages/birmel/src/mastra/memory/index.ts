import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { getConfig } from "../../config/index.js";

let memoryInstance: Memory | null = null;

export function createMemory(): Memory {
  if (memoryInstance) {
    return memoryInstance;
  }

  const config = getConfig();

  memoryInstance = new Memory({
    storage: new LibSQLStore({
      id: "birmel-memory",
      url: config.mastra.memoryDbPath,
    }),
    options: {
      lastMessages: 20,
      semanticRecall: {
        topK: 5,
        messageRange: 3,
      },
    },
  });

  return memoryInstance;
}

export function getMemory(): Memory {
  if (!memoryInstance) {
    return createMemory();
  }
  return memoryInstance;
}

/**
 * Generate a thread ID from channel and user IDs.
 * Thread = specific conversation context.
 */
export function getThreadId(channelId: string, userId: string): string {
  return `channel:${channelId}:user:${userId}`;
}

/**
 * Generate a resource ID from user ID.
 * Resource = the user entity (memory persists across threads for same user).
 */
export function getResourceId(userId: string): string {
  return `user:${userId}`;
}
