import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import {
  handleGetMemory,
  handleUpdateMemory,
  handleAppendMemory,
  handleClearMemory,
  type MemoryScope,
} from "./memory-actions.ts";

// Accept the legacy "owner" scope and map it to "persona" so older prompts /
// tool calls keep working after the rename.
function normalizeScope(scope: "server" | "channel" | "persona" | "owner"): MemoryScope {
  return scope === "owner" ? "persona" : scope;
}

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description:
    "Manage saved memory with three scopes: 'server' (permanent server-wide rules, shared), 'channel' (this channel's saved rules/notes, shared), or 'persona' (the active persona's preferences, switches with ownership). Channel scope targets the current channel automatically.",
  inputSchema: z.object({
    action: z
      .enum(["get", "update", "append", "clear"])
      .describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    scope: z
      .enum(["server", "channel", "persona", "owner"])
      .default("server")
      .describe(
        "Memory scope: 'server' (permanent shared rules, default), 'channel' (this channel's saved memory), or 'persona' (active persona's preferences). 'owner' is a legacy alias for 'persona'.",
      ),
    memory: z
      .string()
      .optional()
      .describe("Memory content in markdown format (for update)"),
    item: z.string().optional().describe("Item to add (for append)"),
    section: z
      .enum(["rules", "preferences", "notes"])
      .optional()
      .describe("Section to append to (for append)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({ memory: z.string() }).optional(),
  }),
  execute: async (ctx) => {
    try {
      // Channel scope always targets the channel the request originated in,
      // never a model-supplied id.
      const ref = {
        guildId: ctx.guildId,
        scope: normalizeScope(ctx.scope),
        channelId: getRequestContext()?.sourceChannelId,
      };
      switch (ctx.action) {
        case "get":
          return await handleGetMemory(ref);
        case "update":
          return await handleUpdateMemory(ref, ctx.memory);
        case "append":
          return await handleAppendMemory(ref, ctx.item, ctx.section);
        case "clear":
          return await handleClearMemory(ref);
      }
    } catch (error) {
      logger.error("Failed to manage memory", error);
      return { success: false, message: "Failed to manage memory" };
    }
  },
});

export const memoryTools = [manageMemoryTool];
