import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getMemory, getGlobalThreadId } from "../../memory/index.js";
import { logger } from "../../../utils/logger.js";

export const updateGlobalMemoryTool = createTool({
  id: "update-global-memory",
  description:
    "Update the server's global memory with persistent rules or instructions. Use this when users say things like 'remember to always X', 'don't do Y', or 'from now on, Z'. This memory persists across all conversations and channels.",
  inputSchema: z.object({
    guildId: z.string().describe("The guild/server ID"),
    memory: z
      .string()
      .describe(
        "The complete updated memory content in markdown format. Should include all existing rules plus any new ones."
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const memory = getMemory();
      const threadId = getGlobalThreadId(input.guildId);

      // Ensure thread exists, create if not
      let thread = await memory.getThreadById({ threadId });
      if (!thread) {
        thread = await memory.createThread({
          threadId,
          resourceId: `guild:${input.guildId}`,
          metadata: {
            workingMemory: input.memory,
          },
        });
      } else {
        // Update the working memory
        await memory.updateWorkingMemory({
          threadId,
          workingMemory: input.memory,
        });
      }

      logger.info("Global memory updated", { guildId: input.guildId });

      return {
        success: true,
        message: "Global memory updated successfully",
      };
    } catch (error) {
      logger.error("Failed to update global memory", error);
      return {
        success: false,
        message: "Failed to update global memory",
      };
    }
  },
});

export const getGlobalMemoryTool = createTool({
  id: "get-global-memory",
  description:
    "Retrieve the server's current global memory containing persistent rules and instructions.",
  inputSchema: z.object({
    guildId: z.string().describe("The guild/server ID"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        memory: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const memory = getMemory();
      const threadId = getGlobalThreadId(input.guildId);

      const thread = await memory.getThreadById({ threadId });

      if (!thread?.metadata?.["workingMemory"]) {
        return {
          success: true,
          message: "No global memory set yet",
          data: {
            memory: "# Server Rules & Persistent Instructions\n(none yet)",
          },
        };
      }

      return {
        success: true,
        message: "Retrieved global memory",
        data: {
          memory: thread.metadata["workingMemory"] as string,
        },
      };
    } catch (error) {
      logger.error("Failed to get global memory", error);
      return {
        success: false,
        message: "Failed to get global memory",
      };
    }
  },
});

export const memoryTools = [updateGlobalMemoryTool, getGlobalMemoryTool];
