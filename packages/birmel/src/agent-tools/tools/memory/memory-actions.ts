import {
  getServerWorkingMemory,
  updateServerWorkingMemory,
  getPersonaWorkingMemory,
  updatePersonaWorkingMemory,
  getChannelWorkingMemory,
  updateChannelWorkingMemory,
  SERVER_MEMORY_TEMPLATE,
  PERSONA_MEMORY_TEMPLATE,
  CHANNEL_MEMORY_TEMPLATE,
} from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const MAX_MEMORY_SIZE = 4000;

type MemoryResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

// ---------------------------------------------------------------------------
// Prompt working memory (markdown templates stored via VoltAgent libSQL).
//
// Three scopes: `server` (permanent, shared), `channel` (this channel's saved
// rules/notes, shared) and `persona` (the active persona's preferences). The
// legacy `owner` scope is mapped to `persona` by the tool layer.
// ---------------------------------------------------------------------------

export type PromptMemoryScope = "server" | "channel" | "persona";

/** Identifies which prompt memory to act on. `channelId` is required for channel scope. */
export type ScopeRef = {
  guildId: string;
  scope: PromptMemoryScope;
  channelId: string | undefined;
};

type SectionKey = "rules" | "preferences" | "notes";
type SectionHeaders = Record<SectionKey, string>;

const SECTION_HEADERS: Record<PromptMemoryScope, SectionHeaders> = {
  server: {
    rules: "# Server Rules",
    preferences: "# Preferences",
    notes: "# Notes",
  },
  channel: {
    rules: "# Channel Rules",
    preferences: "# Channel Preferences",
    notes: "# Channel Notes",
  },
  persona: {
    rules: "# Persona Rules",
    preferences: "# Persona Preferences",
    notes: "# Persona Notes",
  },
};

function appendToSection(
  memory: string,
  section: SectionKey,
  item: string,
  scope: PromptMemoryScope,
): string {
  const header = SECTION_HEADERS[scope][section];

  const lines = memory.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === header);

  if (headerIndex === -1) {
    return `${memory.trimEnd()}\n\n${header}\n- ${item}\n`;
  }

  let insertIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith("# ") === true) {
      insertIndex = i;
      break;
    }
  }

  lines.splice(insertIndex, 0, `- ${item}`);
  return lines.join("\n");
}

type ScopeTarget = {
  label: string;
  template: string;
  read: () => Promise<string | null>;
  write: (content: string) => Promise<void>;
};

type ResolvedScope = { target: ScopeTarget } | { error: string };

/**
 * Resolve a scope to its read/write functions, template, and a human label.
 * For `persona` scope the active persona is derived from the guild; for
 * `channel` scope a channelId (from request context) is required. Returns a
 * `{ error }` object when the scope cannot be resolved.
 */
async function resolveScopeTarget(ref: ScopeRef): Promise<ResolvedScope> {
  const { guildId, scope, channelId } = ref;
  switch (scope) {
    case "server":
      return {
        target: {
          label: "server",
          template: SERVER_MEMORY_TEMPLATE,
          read: () => getServerWorkingMemory(guildId),
          write: (content) => updateServerWorkingMemory(guildId, content),
        },
      };
    case "channel": {
      if (channelId == null || channelId.length === 0) {
        return { error: "Could not determine channel for channel memory" };
      }
      return {
        target: {
          label: "channel",
          template: CHANNEL_MEMORY_TEMPLATE,
          read: () => getChannelWorkingMemory(channelId),
          write: (content) => updateChannelWorkingMemory(channelId, content),
        },
      };
    }
    case "persona": {
      const persona = await getGuildPersona(guildId);
      if (persona.length === 0) {
        return { error: "Could not determine persona for persona memory" };
      }
      return {
        target: {
          label: `persona (${persona})`,
          template: PERSONA_MEMORY_TEMPLATE,
          read: () => getPersonaWorkingMemory(guildId, persona),
          write: (content) =>
            updatePersonaWorkingMemory(guildId, persona, content),
        },
      };
    }
  }
}

export async function handleGetMemory(ref: ScopeRef): Promise<MemoryResult> {
  const resolved = await resolveScopeTarget(ref);
  if ("error" in resolved) {
    return { success: false, message: resolved.error };
  }
  const { target } = resolved;

  const memoryContent = await target.read();
  if (memoryContent == null || memoryContent.length === 0) {
    return {
      success: true,
      message: `No ${target.label} memory set yet`,
      data: { memory: target.template },
    };
  }
  return {
    success: true,
    message: `Retrieved ${target.label} memory`,
    data: { memory: memoryContent },
  };
}

export async function handleUpdateMemory(
  ref: ScopeRef,
  memory: string | undefined,
): Promise<MemoryResult> {
  if (memory == null || memory.length === 0) {
    return { success: false, message: "memory is required for update" };
  }
  if (memory.length > MAX_MEMORY_SIZE) {
    return {
      success: false,
      message: `Memory too long (${String(memory.length)} chars, max ${String(MAX_MEMORY_SIZE)}). Summarize or remove old items.`,
    };
  }

  const resolved = await resolveScopeTarget(ref);
  if ("error" in resolved) {
    return { success: false, message: resolved.error };
  }
  const { target } = resolved;

  await target.write(memory);
  logger.info(`${target.label} memory updated`, {
    guildId: ref.guildId,
    scope: ref.scope,
  });
  return {
    success: true,
    message: `${target.label} memory updated successfully`,
  };
}

export async function handleAppendMemory(
  ref: ScopeRef,
  item: string | undefined,
  section: SectionKey | undefined,
): Promise<MemoryResult> {
  if (item == null || item.length === 0 || !section) {
    return {
      success: false,
      message: "item and section are required for append",
    };
  }

  const resolved = await resolveScopeTarget(ref);
  if ("error" in resolved) {
    return { success: false, message: resolved.error };
  }
  const { target } = resolved;

  const current = await target.read();
  const updated = appendToSection(
    current ?? target.template,
    section,
    item,
    ref.scope,
  );
  if (updated.length > MAX_MEMORY_SIZE) {
    return {
      success: false,
      message: `Memory would exceed max size (${String(MAX_MEMORY_SIZE)} chars). Use 'get' to review and remove old items first.`,
    };
  }

  await target.write(updated);
  logger.info(`${target.label} memory appended`, {
    guildId: ref.guildId,
    scope: ref.scope,
    section,
  });
  return {
    success: true,
    message: `Added to ${target.label} ${section}: ${item}`,
  };
}

export async function handleClearMemory(ref: ScopeRef): Promise<MemoryResult> {
  const resolved = await resolveScopeTarget(ref);
  if ("error" in resolved) {
    return { success: false, message: resolved.error };
  }
  const { target } = resolved;

  await target.write(target.template);
  logger.info(`${target.label} memory cleared`, {
    guildId: ref.guildId,
    scope: ref.scope,
  });
  return {
    success: true,
    message: `${target.label} memory cleared to default template`,
  };
}

// ---------------------------------------------------------------------------
// Structured durable memory (records persisted in the `AgentMemory` table).
//
// Scopes: server/owner/channel/user/session, with tags, source metadata,
// salience, and embeddings. Managed via add/search/delete plus get/update by
// record id.
// ---------------------------------------------------------------------------

export type StructuredMemoryScope =
  | "server"
  | "owner"
  | "channel"
  | "user"
  | "session";

function normalizeTags(tags: string[] | undefined): string | null {
  if (tags == null || tags.length === 0) {
    return null;
  }
  return JSON.stringify(tags);
}

function memoryScopeWhere(options: {
  guildId: string;
  scope?: StructuredMemoryScope | undefined;
  channelId?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
}) {
  return {
    guildId: options.guildId,
    ...(options.scope == null ? {} : { scope: options.scope }),
    ...(options.channelId == null ? {} : { channelId: options.channelId }),
    ...(options.userId == null ? {} : { userId: options.userId }),
    ...(options.sessionId == null ? {} : { sessionId: options.sessionId }),
  };
}

export async function handleAddStructuredMemory(options: {
  guildId: string;
  scope: StructuredMemoryScope;
  content: string | undefined;
  key?: string | undefined;
  tags?: string[] | undefined;
  channelId?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  salience?: number | undefined;
  embedding?: string | undefined;
}): Promise<MemoryResult> {
  if (options.content == null || options.content.length === 0) {
    return { success: false, message: "content is required" };
  }
  const memory = await prisma.agentMemory.create({
    data: {
      guildId: options.guildId,
      scope: options.scope,
      key: options.key ?? null,
      content: options.content,
      tags: normalizeTags(options.tags),
      channelId: options.channelId ?? null,
      userId: options.userId ?? null,
      sessionId: options.sessionId ?? null,
      sourceType: options.sourceType ?? null,
      sourceId: options.sourceId ?? null,
      salience: options.salience ?? 0.5,
      embedding: options.embedding ?? null,
    },
  });
  return {
    success: true,
    message: "Memory record added",
    data: { memory },
  };
}

export async function handleSearchStructuredMemory(options: {
  guildId: string;
  scope?: StructuredMemoryScope | undefined;
  query?: string | undefined;
  channelId?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
}): Promise<MemoryResult> {
  const query = options.query?.trim();
  const memories = await prisma.agentMemory.findMany({
    where: {
      ...memoryScopeWhere(options),
      ...(query == null || query.length === 0
        ? {}
        : {
            OR: [
              { content: { contains: query } },
              { key: { contains: query } },
              { tags: { contains: query } },
            ],
          }),
    },
    orderBy: [{ salience: "desc" }, { updatedAt: "desc" }],
    take: 25,
  });
  return {
    success: true,
    message: `Found ${String(memories.length)} memory record${memories.length === 1 ? "" : "s"}`,
    data: { memories },
  };
}

export async function handleGetStructuredMemory(options: {
  guildId: string;
  memoryId?: string | undefined;
}): Promise<MemoryResult> {
  if (options.memoryId == null || options.memoryId.length === 0) {
    return { success: false, message: "memoryId is required" };
  }
  const memory = await prisma.agentMemory.findFirst({
    where: { id: options.memoryId, guildId: options.guildId },
  });
  if (memory == null) {
    return { success: false, message: "Memory record not found" };
  }
  return { success: true, message: "Memory record found", data: { memory } };
}

export async function handleUpdateStructuredMemory(options: {
  guildId: string;
  memoryId?: string | undefined;
  content?: string | undefined;
  key?: string | undefined;
  tags?: string[] | undefined;
  salience?: number | undefined;
  embedding?: string | undefined;
}): Promise<MemoryResult> {
  if (options.memoryId == null || options.memoryId.length === 0) {
    return { success: false, message: "memoryId is required" };
  }
  const existing = await prisma.agentMemory.findFirst({
    where: { id: options.memoryId, guildId: options.guildId },
  });
  if (existing == null) {
    return { success: false, message: "Memory record not found" };
  }
  const memory = await prisma.agentMemory.update({
    where: { id: existing.id },
    data: {
      content: options.content ?? existing.content,
      key: options.key ?? existing.key,
      tags: options.tags == null ? existing.tags : normalizeTags(options.tags),
      salience: options.salience ?? existing.salience,
      embedding: options.embedding ?? existing.embedding,
    },
  });
  return { success: true, message: "Memory record updated", data: { memory } };
}

export async function handleDeleteStructuredMemory(options: {
  guildId: string;
  memoryId?: string | undefined;
}): Promise<MemoryResult> {
  if (options.memoryId == null || options.memoryId.length === 0) {
    return { success: false, message: "memoryId is required" };
  }
  const deleted = await prisma.agentMemory.deleteMany({
    where: { id: options.memoryId, guildId: options.guildId },
  });
  if (deleted.count === 0) {
    return { success: false, message: "Memory record not found" };
  }
  return { success: true, message: "Memory record deleted" };
}
