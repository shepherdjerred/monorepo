import {
  getServerWorkingMemory,
  updateServerWorkingMemory,
  getOwnerWorkingMemory,
  updateOwnerWorkingMemory,
  SERVER_MEMORY_TEMPLATE,
  OWNER_MEMORY_TEMPLATE,
} from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { getGuildPersona } from "@shepherdjerred/birmel/persona/guild-persona.ts";
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
  data?: { memory: string };
};

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
