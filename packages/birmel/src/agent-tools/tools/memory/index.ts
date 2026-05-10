import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  handleGetMemory,
  handleUpdateMemory,
  handleAppendMemory,
  handleClearMemory,
} from "./memory-actions.ts";

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description:
    "Manage server memory with two scopes: 'server' (permanent rules) or 'owner' (current owner's preferences that switch when ownership changes)",
  inputSchema: z.object({
    action: z
      .enum(["get", "update", "append", "clear"])
      .describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    scope: z
      .enum(["server", "owner"])
      .default("server")
      .describe(
        "Memory scope: 'server' for permanent rules (default), 'owner' for current owner's preferences",
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
      switch (ctx.action) {
        case "get":
          return await handleGetMemory(ctx.guildId, ctx.scope);
        case "update":
          return await handleUpdateMemory(ctx.guildId, ctx.scope, ctx.memory);
        case "append":
          return await handleAppendMemory(
            ctx.guildId,
            ctx.scope,
            ctx.item,
            ctx.section,
          );
        case "clear":
          return await handleClearMemory(ctx.guildId, ctx.scope);
      }
    } catch (error) {
      logger.error("Failed to manage memory", error);
      return { success: false, message: "Failed to manage memory" };
    }
  },
});

export const memoryTools = [manageMemoryTool];
