import {
  getServerWorkingMemory,
  updateServerWorkingMemory,
  getOwnerWorkingMemory,
  updateOwnerWorkingMemory,
  SERVER_MEMORY_TEMPLATE,
  OWNER_MEMORY_TEMPLATE,
} from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const MAX_MEMORY_SIZE = 4000;

type SectionKey = "rules" | "preferences" | "notes";
type SectionHeaders = Record<SectionKey, string>;

function appendToSection(
  memory: string,
  section: SectionKey,
  item: string,
  scope: "server" | "owner" = "server",
): string {
  const serverSectionHeaders: SectionHeaders = {
    rules: "# Server Rules",
    preferences: "# Preferences",
    notes: "# Notes",
  };
  const ownerSectionHeaders: SectionHeaders = {
    rules: "# Owner Rules",
    preferences: "# Owner Preferences",
    notes: "# Owner Notes",
  };
  const sectionHeaders: SectionHeaders =
    scope === "owner" ? ownerSectionHeaders : serverSectionHeaders;
  const header = sectionHeaders[section];

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

type MemoryResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

export type MemoryScope = "server" | "owner" | "channel" | "user" | "session";

export async function handleGetMemory(
  guildId: string,
  scope: "server" | "owner",
): Promise<MemoryResult> {
  const persona = scope === "owner" ? await getGuildPersona(guildId) : null;
  const scopeLabel =
    scope === "owner" ? `owner (${persona ?? "unknown"})` : "server";
  const template =
    scope === "owner" ? OWNER_MEMORY_TEMPLATE : SERVER_MEMORY_TEMPLATE;

  let memoryContent: string | null;
  if (scope === "owner") {
    if (persona == null || persona.length === 0) {
      return {
        success: false,
        message: "Could not determine persona for owner memory",
      };
    }
    memoryContent = await getOwnerWorkingMemory(guildId, persona);
  } else {
    memoryContent = await getServerWorkingMemory(guildId);
  }

  if (memoryContent == null || memoryContent.length === 0) {
    return {
      success: true,
      message: `No ${scopeLabel} memory set yet`,
      data: { memory: template },
    };
  }
  return {
    success: true,
    message: `Retrieved ${scopeLabel} memory`,
    data: { memory: memoryContent },
  };
}

export async function handleUpdateMemory(
  guildId: string,
  scope: "server" | "owner",
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

  const persona = scope === "owner" ? await getGuildPersona(guildId) : null;
  const scopeLabel =
    scope === "owner" ? `owner (${persona ?? "unknown"})` : "server";

  if (scope === "owner") {
    if (persona == null || persona.length === 0) {
      return {
        success: false,
        message: "Could not determine persona for owner memory",
      };
    }
    await updateOwnerWorkingMemory(guildId, persona, memory);
  } else {
    await updateServerWorkingMemory(guildId, memory);
  }
  logger.info(`${scopeLabel} memory updated`, { guildId, scope });
  return {
    success: true,
    message: `${scopeLabel} memory updated successfully`,
  };
}

export async function handleAppendMemory(
  guildId: string,
  scope: "server" | "owner",
  item: string | undefined,
  section: SectionKey | undefined,
): Promise<MemoryResult> {
  if (item == null || item.length === 0 || !section) {
    return {
      success: false,
      message: "item and section are required for append",
    };
  }

  const persona = scope === "owner" ? await getGuildPersona(guildId) : null;
  const scopeLabel =
    scope === "owner" ? `owner (${persona ?? "unknown"})` : "server";
  const template =
    scope === "owner" ? OWNER_MEMORY_TEMPLATE : SERVER_MEMORY_TEMPLATE;

  let current: string | null;
  if (scope === "owner") {
    if (persona == null || persona.length === 0) {
      return {
        success: false,
        message: "Could not determine persona for owner memory",
      };
    }
    current = await getOwnerWorkingMemory(guildId, persona);
  } else {
    current = await getServerWorkingMemory(guildId);
  }

  const updated = appendToSection(current ?? template, section, item, scope);
  if (updated.length > MAX_MEMORY_SIZE) {
    return {
      success: false,
      message: `Memory would exceed max size (${String(MAX_MEMORY_SIZE)} chars). Use 'get' to review and remove old items first.`,
    };
  }

  if (scope === "owner") {
    if (persona == null || persona.length === 0) {
      return {
        success: false,
        message: "Could not determine persona for owner memory",
      };
    }
    await updateOwnerWorkingMemory(guildId, persona, updated);
  } else {
    await updateServerWorkingMemory(guildId, updated);
  }
  logger.info(`${scopeLabel} memory appended`, {
    guildId,
    scope,
    section,
  });
  return {
    success: true,
    message: `Added to ${scopeLabel} ${section}: ${item}`,
  };
}

export async function handleClearMemory(
  guildId: string,
  scope: "server" | "owner",
): Promise<MemoryResult> {
  const persona = scope === "owner" ? await getGuildPersona(guildId) : null;
  const scopeLabel =
    scope === "owner" ? `owner (${persona ?? "unknown"})` : "server";
  const template =
    scope === "owner" ? OWNER_MEMORY_TEMPLATE : SERVER_MEMORY_TEMPLATE;

  if (scope === "owner") {
    if (persona == null || persona.length === 0) {
      return {
        success: false,
        message: "Could not determine persona for owner memory",
      };
    }
    await updateOwnerWorkingMemory(guildId, persona, template);
  } else {
    await updateServerWorkingMemory(guildId, template);
  }
  logger.info(`${scopeLabel} memory cleared`, { guildId, scope });
  return {
    success: true,
    message: `${scopeLabel} memory cleared to default template`,
  };
}

function normalizeTags(tags: string[] | undefined): string | null {
  if (tags == null || tags.length === 0) {
    return null;
  }
  return JSON.stringify(tags);
}

function memoryScopeWhere(options: {
  guildId: string;
  scope?: MemoryScope | undefined;
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
  scope: MemoryScope;
  content?: string | undefined;
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
  scope?: MemoryScope | undefined;
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
