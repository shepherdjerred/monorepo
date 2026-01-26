import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import {
  getServerWorkingMemory,
  updateServerWorkingMemory,
  getOwnerWorkingMemory,
  updateOwnerWorkingMemory,
  SERVER_MEMORY_TEMPLATE,
  OWNER_MEMORY_TEMPLATE,
} from "../../../voltagent/memory/index.js";
import { getGuildPersona } from "../../../persona/index.js";
import { logger } from "../../../utils/logger.js";

const MAX_MEMORY_SIZE = 4000;

/**
 * Append an item to a specific section in the memory markdown.
 * Sections are identified by "# Section Name" headers.
 */
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
  const sectionHeaders: SectionHeaders = scope === "owner" ? ownerSectionHeaders : serverSectionHeaders;
  const header = sectionHeaders[section];

  const lines = memory.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === header);

  if (headerIndex === -1) {
    // Section doesn't exist, add it at the end
    return `${memory.trimEnd()}\n\n${header}\n- ${item}\n`;
  }

  // Find the next section or end of content
  let insertIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith("# ")) {
      insertIndex = i;
      break;
    }
  }

  // Insert the new item before the next section
  lines.splice(insertIndex, 0, `- ${item}`);
  return lines.join("\n");
}

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description: "Manage server memory with two scopes: 'server' (permanent rules) or 'owner' (current owner's preferences that switch when ownership changes)",
  inputSchema: z.object({
    action: z.enum(["get", "update", "append", "clear"]).describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    scope: z.enum(["server", "owner"]).default("server").describe("Memory scope: 'server' for permanent rules (default), 'owner' for current owner's preferences"),
    memory: z.string().optional().describe("Memory content in markdown format (for update)"),
    item: z.string().optional().describe("Item to add (for append)"),
    section: z.enum(["rules", "preferences", "notes"]).optional().describe("Section to append to (for append)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({ memory: z.string() }).optional(),
  }),
  execute: async (ctx) => {
    try {
      const scope = ctx.scope;
      const persona = scope === "owner" ? await getGuildPersona(ctx.guildId) : null;
      const scopeLabel = scope === "owner" ? `owner (${persona})` : "server";
      const template = scope === "owner" ? OWNER_MEMORY_TEMPLATE : SERVER_MEMORY_TEMPLATE;

      switch (ctx.action) {
        case "get": {
          const memoryContent = scope === "owner"
            ? await getOwnerWorkingMemory(ctx.guildId, persona!)
            : await getServerWorkingMemory(ctx.guildId);

          if (!memoryContent) {
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

        case "update": {
          if (!ctx.memory) return { success: false, message: "memory is required for update" };
          // Limit memory size to avoid token bloat
          if (ctx.memory.length > MAX_MEMORY_SIZE) {
            return {
              success: false,
              message: `Memory too long (${String(ctx.memory.length)} chars, max ${String(MAX_MEMORY_SIZE)}). Summarize or remove old items.`,
            };
          }

          if (scope === "owner") {
            await updateOwnerWorkingMemory(ctx.guildId, persona!, ctx.memory);
          } else {
            await updateServerWorkingMemory(ctx.guildId, ctx.memory);
          }
          logger.info(`${scopeLabel} memory updated`, { guildId: ctx.guildId, scope });
          return { success: true, message: `${scopeLabel} memory updated successfully` };
        }

        case "append": {
          if (!ctx.item || !ctx.section) {
            return { success: false, message: "item and section are required for append" };
          }

          const current = scope === "owner"
            ? await getOwnerWorkingMemory(ctx.guildId, persona!)
            : await getServerWorkingMemory(ctx.guildId);

          const updated = appendToSection(current ?? template, ctx.section, ctx.item, scope);
          if (updated.length > MAX_MEMORY_SIZE) {
            return {
              success: false,
              message: `Memory would exceed max size (${String(MAX_MEMORY_SIZE)} chars). Use 'get' to review and remove old items first.`,
            };
          }

          if (scope === "owner") {
            await updateOwnerWorkingMemory(ctx.guildId, persona!, updated);
          } else {
            await updateServerWorkingMemory(ctx.guildId, updated);
          }
          logger.info(`${scopeLabel} memory appended`, { guildId: ctx.guildId, scope, section: ctx.section });
          return { success: true, message: `Added to ${scopeLabel} ${ctx.section}: ${ctx.item}` };
        }

        case "clear": {
          if (scope === "owner") {
            await updateOwnerWorkingMemory(ctx.guildId, persona!, template);
          } else {
            await updateServerWorkingMemory(ctx.guildId, template);
          }
          logger.info(`${scopeLabel} memory cleared`, { guildId: ctx.guildId, scope });
          return { success: true, message: `${scopeLabel} memory cleared to default template` };
        }
      }
    } catch (error) {
      logger.error("Failed to manage memory", error);
      return { success: false, message: "Failed to manage memory" };
    }
  },
});

export const memoryTools = [manageMemoryTool];
