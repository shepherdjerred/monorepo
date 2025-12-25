import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getMemory, getGlobalThreadId } from "../../memory/index.js";
import { logger } from "../../../utils/logger.js";

export const manageMemoryTool = createTool({
  id: "manage-memory",
  description: "Manage server's global memory: get or update persistent rules and instructions",
  inputSchema: z.object({
    action: z.enum(["get", "update"]).describe("The action to perform"),
    guildId: z.string().describe("The guild/server ID"),
    memory: z.string().optional().describe("Memory content in markdown format (for update)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({ memory: z.string() }).optional(),
  }),
  execute: async (ctx) => {
    try {
      const memory = getMemory();
      const threadId = getGlobalThreadId(ctx.guildId);

      switch (ctx.action) {
        case "get": {
          const thread = await memory.getThreadById({ threadId });
          if (!thread?.metadata?.["workingMemory"]) {
            return {
              success: true,
              message: "No global memory set yet",
              data: { memory: "# Server Rules & Persistent Instructions\n(none yet)" },
            };
          }
          return {
            success: true,
            message: "Retrieved global memory",
            data: { memory: thread.metadata["workingMemory"] as string },
          };
        }

        case "update": {
          if (!ctx.memory) return { success: false, message: "memory is required for update" };
          let thread = await memory.getThreadById({ threadId });
          if (!thread) {
            thread = await memory.createThread({
              threadId,
              resourceId: `guild:${ctx.guildId}`,
              metadata: { workingMemory: ctx.memory },
            });
          } else {
            await memory.updateWorkingMemory({ threadId, workingMemory: ctx.memory });
          }
          logger.info("Global memory updated", { guildId: ctx.guildId });
          return { success: true, message: "Global memory updated successfully" };
        }
      }
    } catch (error) {
      logger.error("Failed to manage memory", error);
      return { success: false, message: "Failed to manage memory" };
    }
  },
});

export const memoryTools = [manageMemoryTool];
