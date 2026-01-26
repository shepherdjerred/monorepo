import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { getConfig } from "../../config/index.js";

let memoryInstance: Memory | null = null;

/**
 * Working memory template for server-wide rules (permanent, independent of owner).
 */
export const SERVER_MEMORY_TEMPLATE = `# Server Rules
- (none yet)

# Preferences
- (none yet)

# Notes
- (none yet)
`;

/**
 * Working memory template for owner-specific preferences (switches when ownership changes).
 */
export const OWNER_MEMORY_TEMPLATE = `# Owner Rules
- (none yet)

# Owner Preferences
- (none yet)

# Owner Notes
- (none yet)
`;

// Keep old name for backwards compatibility
const GLOBAL_MEMORY_TEMPLATE = SERVER_MEMORY_TEMPLATE;

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
      url: config.mastra.memoryDbPath,
    }),
    embedder: "openai/text-embedding-3-small",
    options: {
      lastMessages: 2,
      semanticRecall: {
        topK: 3,
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
 * SERVER MEMORY - Permanent server-wide rules and instructions
 * Persists regardless of owner. Used for "remember to always X".
 */
export function getGlobalThreadId(guildId: string): string {
  return `guild:${guildId}:global`;
}

// Alias for clarity
export const getServerThreadId = getGlobalThreadId;

export function getGlobalResourceId(guildId: string): string {
  return `guild:${guildId}`;
}

/**
 * OWNER MEMORY - Owner-specific preferences and rules
 * Tied to the current elected owner. Switches when ownership changes.
 */
export function getOwnerThreadId(guildId: string, ownerPersona: string): string {
  return `guild:${guildId}:owner:${ownerPersona}`;
}

export function getOwnerResourceId(guildId: string): string {
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
