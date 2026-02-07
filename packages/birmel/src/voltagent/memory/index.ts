import { Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter, LibSQLVectorAdapter } from "@voltagent/libsql";
import { openai } from "@ai-sdk/openai";
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

export function createMemory(): Memory {
  if (memoryInstance) {
    return memoryInstance;
  }

  const config = getConfig();

  memoryInstance = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: config.mastra.memoryDbPath,
    }),
    embedding: openai.embedding("text-embedding-3-small"),
    vector: new LibSQLVectorAdapter({
      url: config.mastra.memoryDbPath,
    }),
    workingMemory: {
      enabled: true,
      template: SERVER_MEMORY_TEMPLATE,
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

// System user ID for server/owner memory (not a real Discord user)
const SYSTEM_USER_ID = "system";

/**
 * SERVER MEMORY - Permanent server-wide rules and instructions
 * Persists regardless of owner. Used for "remember to always X".
 * Uses conversationId-based storage.
 */
export function getServerConversationId(guildId: string): string {
  return `guild:${guildId}:server`;
}

// Legacy alias
export const getGlobalThreadId = getServerConversationId;
export const getServerThreadId = getServerConversationId;

export function getGlobalResourceId(guildId: string): string {
  return `guild:${guildId}`;
}

/**
 * OWNER MEMORY - Owner-specific preferences and rules
 * Tied to the current elected owner. Switches when ownership changes.
 * Uses conversationId-based storage.
 */
export function getOwnerConversationId(guildId: string, ownerPersona: string): string {
  return `guild:${guildId}:owner:${ownerPersona}`;
}

// Legacy alias
export const getOwnerThreadId = getOwnerConversationId;

export function getOwnerResourceId(guildId: string): string {
  return `guild:${guildId}`;
}

/**
 * CHANNEL MEMORY - Per-channel conversation context
 * Shared by all users in a channel. Tracks the channel's conversation.
 * VoltAgent auto-manages this via conversationId in streamText calls.
 */
export function getChannelConversationId(channelId: string): string {
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
      conversationId: getServerConversationId(ctx.guildId),
      resourceId: getGlobalResourceId(ctx.guildId),
    },
    channel: {
      conversationId: getChannelConversationId(ctx.channelId),
      resourceId: getChannelResourceId(ctx.guildId),
    },
    user: {
      conversationId: getUserThreadId(ctx.userId),
      resourceId: getUserResourceId(ctx.userId),
    },
  };
}

// =============================================================================
// Working Memory Access Functions
// =============================================================================

/**
 * Get server working memory for a guild.
 */
export async function getServerWorkingMemory(guildId: string): Promise<string | null> {
  try {
    const memory = getMemory();
    const conversationId = getServerConversationId(guildId);

    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });

    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Update server working memory for a guild.
 */
export async function updateServerWorkingMemory(guildId: string, content: string): Promise<void> {
  const memory = getMemory();
  const conversationId = getServerConversationId(guildId);

  await memory.updateWorkingMemory({
    conversationId,
    userId: SYSTEM_USER_ID,
    content,
  });
}

/**
 * Get owner working memory for a guild.
 */
export async function getOwnerWorkingMemory(guildId: string, persona: string): Promise<string | null> {
  try {
    const memory = getMemory();
    const conversationId = getOwnerConversationId(guildId, persona);

    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });

    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Update owner working memory for a guild.
 */
export async function updateOwnerWorkingMemory(guildId: string, persona: string, content: string): Promise<void> {
  const memory = getMemory();
  const conversationId = getOwnerConversationId(guildId, persona);

  await memory.updateWorkingMemory({
    conversationId,
    userId: SYSTEM_USER_ID,
    content,
  });
}

// Legacy exports for backwards compatibility
export function getThreadId(channelId: string, userId: string): string {
  return `channel:${channelId}:user:${userId}`;
}

export function getResourceId(userId: string): string {
  return `user:${userId}`;
}
