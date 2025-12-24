import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { getConfig } from "../../config/index.js";

let memoryInstance: Memory | null = null;

/**
 * Working memory template for global server rules and persistent instructions.
 * This is what gets updated when someone says "remember to always X" or "don't do Y".
 */
const GLOBAL_MEMORY_TEMPLATE = `# Server Rules & Persistent Instructions
Instructions that apply to all conversations in this server.

## Rules
- (none yet)

## Preferences
- (none yet)

## Notes
- (none yet)
`;

export function createMemory(): Memory {
  if (memoryInstance) {
    return memoryInstance;
  }

  const config = getConfig();

  memoryInstance = new Memory({
    storage: new LibSQLStore({
      id: "memory",
      url: config.mastra.memoryDbPath,
    }),
    vector: new LibSQLVector({
      id: "memory-vector",
      connectionUrl: config.mastra.memoryDbPath,
    }),
    embedder: "openai/text-embedding-3-small",
    options: {
      lastMessages: 8, // Reduced from 20 to prevent token overflow (each message can be large with tool calls)
      semanticRecall: {
        topK: 5,
        messageRange: 2,
      },
      workingMemory: {
        enabled: true,
        template: GLOBAL_MEMORY_TEMPLATE,
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

// =============================================================================
// Three-Tier Memory System
// =============================================================================

/**
 * GLOBAL MEMORY - Server-wide rules and instructions
 * Persists across all channels and users. Used for "remember to always X".
 */
export function getGlobalThreadId(guildId: string): string {
  return `guild:${guildId}:global`;
}

export function getGlobalResourceId(guildId: string): string {
  return `guild:${guildId}`;
}

/**
 * CHANNEL MEMORY - Per-channel conversation context
 * Shared by all users in a channel. Tracks the channel's conversation.
 */
export function getChannelThreadId(channelId: string): string {
  return `channel:${channelId}`;
}

export function getChannelResourceId(guildId: string): string {
  return `guild:${guildId}`;
}

/**
 * USER MEMORY - Per-user preferences and history
 * Persists across all channels for a specific user.
 */
export function getUserThreadId(userId: string): string {
  return `user:${userId}`;
}

export function getUserResourceId(userId: string): string {
  return `user:${userId}`;
}

/**
 * Context needed for the three-tier memory system.
 */
export type MemoryContext = {
  guildId: string;
  channelId: string;
  userId: string;
};

/**
 * Get all memory IDs for a given context.
 */
export function getMemoryIds(ctx: MemoryContext) {
  return {
    global: {
      threadId: getGlobalThreadId(ctx.guildId),
      resourceId: getGlobalResourceId(ctx.guildId),
    },
    channel: {
      threadId: getChannelThreadId(ctx.channelId),
      resourceId: getChannelResourceId(ctx.guildId),
    },
    user: {
      threadId: getUserThreadId(ctx.userId),
      resourceId: getUserResourceId(ctx.userId),
    },
  };
}

// Legacy exports for backwards compatibility
export function getThreadId(channelId: string, userId: string): string {
  return `channel:${channelId}:user:${userId}`;
}

export function getResourceId(userId: string): string {
  return `user:${userId}`;
}
