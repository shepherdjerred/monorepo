import { Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter, LibSQLVectorAdapter } from "@voltagent/libsql";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.memory;

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
  if (memoryInstance != null) {
    return memoryInstance;
  }

  const config = getConfig();

  memoryInstance = new Memory({
    storage: new LibSQLMemoryAdapter({
      url: config.agent.memoryDbPath,
    }),
    embedding: openai.embedding("text-embedding-3-small"),
    vector: new LibSQLVectorAdapter({
      url: config.agent.memoryDbPath,
    }),
    workingMemory: {
      enabled: true,
      template: SERVER_MEMORY_TEMPLATE,
    },
  });

  return memoryInstance;
}

export function getMemory(): Memory {
  if (memoryInstance == null) {
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
 * SERVER MEMORY — permanent server-wide rules and instructions.
 * Persists regardless of owner. Used for "remember to always X".
 */
export function getServerConversationId(guildId: string): string {
  return `guild:${guildId}:server`;
}

/**
 * OWNER MEMORY — owner-specific preferences and rules.
 * Tied to the current elected owner; switches when ownership changes.
 */
export function getOwnerConversationId(
  guildId: string,
  ownerPersona: string,
): string {
  return `guild:${guildId}:owner:${ownerPersona}`;
}

/**
 * CHANNEL MEMORY — per-channel conversation context.
 * Shared by all users in a channel. Tracks the channel's conversation.
 * VoltAgent auto-manages this via conversationId in streamText calls.
 */
export function getChannelConversationId(channelId: string): string {
  return `channel:${channelId}`;
}

// =============================================================================
// Working Memory Access Functions
// =============================================================================

/**
 * Get server working memory for a guild.
 *
 * A return of `null` means "no working memory has been written for this
 * guild yet" — that is a normal, non-error state. If the storage layer
 * itself fails (DB IO, schema migration mid-flight, etc.) we log a warning
 * and still return `null`: working memory is non-essential context, so a
 * single failed read should not blow up message handling. The warning is
 * surfaced — never silenced — so the failure shows up in Loki.
 */
export async function getServerWorkingMemory(
  guildId: string,
): Promise<string | null> {
  const memory = getMemory();
  const conversationId = getServerConversationId(guildId);

  try {
    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });
    return result ?? null;
  } catch (error) {
    logger.warn("Failed to read server working memory", {
      guildId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update server working memory for a guild.
 */
export async function updateServerWorkingMemory(
  guildId: string,
  content: string,
): Promise<void> {
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
 *
 * Same `null` semantics as {@link getServerWorkingMemory}: missing data is
 * normal, but storage errors are logged at warn level rather than swallowed.
 */
export async function getOwnerWorkingMemory(
  guildId: string,
  persona: string,
): Promise<string | null> {
  const memory = getMemory();
  const conversationId = getOwnerConversationId(guildId, persona);

  try {
    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });
    return result ?? null;
  } catch (error) {
    logger.warn("Failed to read owner working memory", {
      guildId,
      persona,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update owner working memory for a guild.
 */
export async function updateOwnerWorkingMemory(
  guildId: string,
  persona: string,
  content: string,
): Promise<void> {
  const memory = getMemory();
  const conversationId = getOwnerConversationId(guildId, persona);

  await memory.updateWorkingMemory({
    conversationId,
    userId: SYSTEM_USER_ID,
    content,
  });
}
