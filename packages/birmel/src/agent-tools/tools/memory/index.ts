import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
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
  type PromptMemoryScope,
  type StructuredMemoryScope,
} from "./memory-actions.ts";

// The tool accepts a union of prompt-memory scopes (server/channel/persona, with
// the legacy "owner" alias) and structured-memory scopes
// (server/owner/channel/user/session). get/update/append/clear operate on prompt
// working memory; add/search/delete (and get/update with a memoryId) operate on
// structured durable records.
type InputScope =
  | "server"
  | "channel"
  | "persona"
  | "owner"
  | "user"
  | "session";

// Map the input scope onto a prompt-memory scope. "owner" is a legacy alias for
// "persona". Scopes that only exist for structured memory (user/session) have no
// prompt equivalent and return null.
function toPromptScope(scope: InputScope): PromptMemoryScope | null {
  switch (scope) {
    case "server":
      return "server";
    case "channel":
      return "channel";
    case "persona":
    case "owner":
      return "persona";
    case "user":
    case "session":
      return null;
  }
}

// Map the input scope onto a structured-memory scope. "persona" is the prompt-era
// name for the legacy "owner" structured scope.
function toStructuredScope(scope: InputScope): StructuredMemoryScope {
  return scope === "persona" ? "owner" : scope;
}

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description:
    "Manage Birmel memory. Prompt working memory has three scopes — 'server' (permanent, shared), 'channel' (this channel's saved rules/notes, shared; targets the current channel automatically), and 'persona' (the active persona's preferences; legacy 'owner' is an alias) — managed via get/update/append/clear. Structured durable memory records (tags, source metadata, salience, embeddings) for server/owner/channel/user/session scopes are managed via add/search/delete, plus get/update with a memoryId.",
  inputSchema: z.object({
    action: z
      .enum(["get", "update", "append", "clear", "add", "search", "delete"])
      .describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    scope: z
      .enum(["server", "channel", "persona", "owner", "user", "session"])
      .default("server")
      .describe(
        "Memory scope. Prompt memory (get/update/append/clear): 'server' (default), 'channel', or 'persona' ('owner' is a legacy alias). Structured memory (add/search/delete) also allows 'user' and 'session'.",
      ),
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
      // Prompt working memory: channel scope always targets the channel the
      // request originated in, never a model-supplied id.
      const promptScope = toPromptScope(ctx.scope);
      const promptRef =
        promptScope == null
          ? null
          : {
              guildId: ctx.guildId,
              scope: promptScope,
              channelId: getRequestContext()?.sourceChannelId,
            };
      const structuredScope = toStructuredScope(ctx.scope);

      switch (ctx.action) {
        case "get":
          if (ctx.memoryId != null) {
            return await handleGetStructuredMemory(ctx);
          }
          if (promptRef == null) {
            return {
              success: false,
              message:
                "get on prompt memory supports server, channel, or persona scope; use search for user/session structured memory",
            };
          }
          return await handleGetMemory(promptRef);
        case "update":
          if (ctx.memoryId != null) {
            return await handleUpdateStructuredMemory({
              ...ctx,
              content: ctx.memory,
            });
          }
          if (promptRef == null) {
            return {
              success: false,
              message:
                "update on prompt memory supports server, channel, or persona scope; use add for user/session structured memory",
            };
          }
          return await handleUpdateMemory(promptRef, ctx.memory);
        case "append":
          if (promptRef == null) {
            return {
              success: false,
              message:
                "append on prompt memory supports server, channel, or persona scope; use add for user/session structured memory",
            };
          }
          return await handleAppendMemory(promptRef, ctx.item, ctx.section);
        case "clear":
          if (promptRef == null) {
            return {
              success: false,
              message:
                "clear only supports server, channel, or persona prompt memory",
            };
          }
          return await handleClearMemory(promptRef);
        case "add":
          return await handleAddStructuredMemory({
            ...ctx,
            scope: structuredScope,
            content: ctx.memory ?? ctx.item,
          });
        case "search":
          return await handleSearchStructuredMemory({
            ...ctx,
            scope: structuredScope,
          });
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
