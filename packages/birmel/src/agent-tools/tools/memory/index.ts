import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  handleGetMemory,
  handleUpdateMemory,
  handleAppendMemory,
  handleClearMemory,
  handleAddStructuredMemory,
  handleSearchStructuredMemory,
  handleGetStructuredMemory,
  handleUpdateStructuredMemory,
  handleDeleteStructuredMemory,
} from "./memory-actions.ts";

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description:
    "Manage Birmel memory. Supports legacy prompt memory for server/owner scopes and structured durable memory records for server, owner, channel, user, and session scopes with tags, source metadata, salience, and embeddings.",
  inputSchema: z.object({
    action: z
      .enum(["get", "update", "append", "clear", "add", "search", "delete"])
      .describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    scope: z
      .enum(["server", "owner", "channel", "user", "session"])
      .default("server")
      .describe("Memory scope: server, owner, channel, user, or session"),
    memoryId: z.string().optional().describe("Structured memory record ID"),
    query: z.string().optional().describe("Search query"),
    key: z.string().optional().describe("Optional memory key"),
    tags: z.array(z.string()).optional().describe("Optional tags"),
    channelId: z.string().optional().describe("Channel scope anchor"),
    userId: z.string().optional().describe("User scope anchor"),
    sessionId: z.string().optional().describe("Session scope anchor"),
    sourceType: z.string().optional().describe("Source type"),
    sourceId: z.string().optional().describe("Source ID"),
    salience: z.number().min(0).max(1).optional(),
    embedding: z.string().optional().describe("Serialized vector embedding"),
    memory: z
      .string()
      .optional()
      .describe("Memory content in markdown format or structured content"),
    item: z.string().optional().describe("Item to add (for append)"),
    section: z
      .enum(["rules", "preferences", "notes"])
      .optional()
      .describe("Section to append to (for append)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "get":
          if (ctx.memoryId != null) {
            return await handleGetStructuredMemory(ctx);
          }
          if (ctx.scope === "server" || ctx.scope === "owner") {
            return await handleGetMemory(ctx.guildId, ctx.scope);
          }
          return await handleSearchStructuredMemory(ctx);
        case "update":
          if (ctx.memoryId != null) {
            return await handleUpdateStructuredMemory({
              ...ctx,
              content: ctx.memory,
            });
          }
          if (ctx.scope === "server" || ctx.scope === "owner") {
            return await handleUpdateMemory(ctx.guildId, ctx.scope, ctx.memory);
          }
          return await handleAddStructuredMemory({
            ...ctx,
            content: ctx.memory,
          });
        case "append":
          if (ctx.scope === "server" || ctx.scope === "owner") {
            return await handleAppendMemory(
              ctx.guildId,
              ctx.scope,
              ctx.item,
              ctx.section,
            );
          }
          return await handleAddStructuredMemory({
            ...ctx,
            content: ctx.item,
          });
        case "clear":
          if (ctx.scope !== "server" && ctx.scope !== "owner") {
            return {
              success: false,
              message: "clear only supports server and owner prompt memory",
            };
          }
          return await handleClearMemory(ctx.guildId, ctx.scope);
        case "add":
          return await handleAddStructuredMemory({
            ...ctx,
            content: ctx.memory ?? ctx.item,
          });
        case "search":
          return await handleSearchStructuredMemory(ctx);
        case "delete":
          return await handleDeleteStructuredMemory(ctx);
      }
    } catch (error) {
      logger.error("Failed to manage memory", error);
      return { success: false, message: "Failed to manage memory" };
    }
  },
});

export const memoryTools = [manageMemoryTool];
