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
 * Working memory template for persona-specific preferences. Each persona has
 * its own memory; it switches when ownership/persona changes. (Historically
 * called "owner" memory — the conversationId still uses `:owner:` to preserve
 * already-stored data.)
 */
export const PERSONA_MEMORY_TEMPLATE = `# Persona Rules
- (none yet)

# Persona Preferences
- (none yet)

# Persona Notes
- (none yet)
`;

/** @deprecated Use {@link PERSONA_MEMORY_TEMPLATE}. */
export const OWNER_MEMORY_TEMPLATE = PERSONA_MEMORY_TEMPLATE;

/**
 * Working memory template for channel-specific saved memory (shared by all
 * users and personas in a channel; not keyed per persona).
 */
export const CHANNEL_MEMORY_TEMPLATE = `# Channel Rules
- (none yet)

# Channel Preferences
- (none yet)

# Channel Notes
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
 * PERSONA MEMORY — persona-specific preferences and rules.
 * Each persona has its own memory; switches when ownership/persona changes.
 * NOTE: the id keeps the historical `:owner:` segment so existing stored
 * memory is preserved across this rename.
 */
export function getPersonaConversationId(
  guildId: string,
  persona: string,
): string {
  return `guild:${guildId}:owner:${persona}`;
}

/** @deprecated Use {@link getPersonaConversationId}. */
export const getOwnerConversationId = getPersonaConversationId;

/**
 * CHANNEL CONVERSATION (transcript) — per-channel conversation context.
 * Shared by all users in a channel. VoltAgent auto-manages this via the
 * conversationId passed to streamText calls.
 */
export function getChannelConversationId(channelId: string): string {
  return `channel:${channelId}`;
}

/**
 * CHANNEL MEMORY — explicit, agent-saved per-channel memory (rules / prefs /
 * notes). Shared by all users and personas in a channel (not persona-keyed).
 *
 * IMPORTANT: this id is deliberately DISTINCT from
 * {@link getChannelConversationId} (`channel:<id>`) so the saved working memory
 * does not collide with VoltAgent's auto-managed conversation history.
 */
export function getChannelMemoryConversationId(channelId: string): string {
  return `channel:${channelId}:memory`;
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
 * Get persona working memory for a guild.
 *
 * Same `null` semantics as {@link getServerWorkingMemory}: missing data is
 * normal, but storage errors are logged at warn level rather than swallowed.
 */
export async function getPersonaWorkingMemory(
  guildId: string,
  persona: string,
): Promise<string | null> {
  const memory = getMemory();
  const conversationId = getPersonaConversationId(guildId, persona);

  try {
    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });
    return result ?? null;
  } catch (error) {
    logger.warn("Failed to read persona working memory", {
      guildId,
      persona,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update persona working memory for a guild.
 */
export async function updatePersonaWorkingMemory(
  guildId: string,
  persona: string,
  content: string,
): Promise<void> {
  const memory = getMemory();
  const conversationId = getPersonaConversationId(guildId, persona);

  await memory.updateWorkingMemory({
    conversationId,
    userId: SYSTEM_USER_ID,
    content,
  });
}

/** @deprecated Use {@link getPersonaWorkingMemory}. */
export const getOwnerWorkingMemory = getPersonaWorkingMemory;
/** @deprecated Use {@link updatePersonaWorkingMemory}. */
export const updateOwnerWorkingMemory = updatePersonaWorkingMemory;

/**
 * Get channel working memory (explicit saved memory, not transcript).
 *
 * Same `null` semantics as {@link getServerWorkingMemory}.
 */
export async function getChannelWorkingMemory(
  channelId: string,
): Promise<string | null> {
  const memory = getMemory();
  const conversationId = getChannelMemoryConversationId(channelId);

  try {
    const result = await memory.getWorkingMemory({
      conversationId,
      userId: SYSTEM_USER_ID,
    });
    return result ?? null;
  } catch (error) {
    logger.warn("Failed to read channel working memory", {
      channelId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update channel working memory.
 */
export async function updateChannelWorkingMemory(
  channelId: string,
  content: string,
): Promise<void> {
  const memory = getMemory();
  const conversationId = getChannelMemoryConversationId(channelId);

  await memory.updateWorkingMemory({
    conversationId,
    userId: SYSTEM_USER_ID,
    content,
  });
}
