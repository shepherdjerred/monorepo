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
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

const MAX_MEMORY_SIZE = 4000;

export type MemoryScope = "server" | "channel" | "persona";

/** Identifies which memory to act on. `channelId` is required for channel scope. */
export type ScopeRef = {
  guildId: string;
  scope: MemoryScope;
  channelId: string | undefined;
};

type SectionKey = "rules" | "preferences" | "notes";
type SectionHeaders = Record<SectionKey, string>;

const SECTION_HEADERS: Record<MemoryScope, SectionHeaders> = {
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
  scope: MemoryScope,
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

type MemoryResult = {
  success: boolean;
  message: string;
  data?: { memory: string };
};

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
