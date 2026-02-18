import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "../../../observability/index.js";
import { validateSnowflakes } from "./validation.js";
import {
  handleCreateFromMessage,
  handleCreateStandalone,
  handleModifyThread,
  handleAddMember,
  handleGetThreadMessages,
} from "./thread-actions.js";

const logger = loggers.tools.child("discord.threads");

export const manageThreadTool = createTool({
  id: "manage-thread",
  description:
    "Manage threads: create from message, create standalone, modify settings, add member, or get messages",
  inputSchema: z.object({
    action: z
      .enum([
        "create-from-message",
        "create-standalone",
        "modify",
        "add-member",
        "get-messages",
      ])
      .describe("The action to perform"),
    channelId: z
      .string()
      .optional()
      .describe("The channel ID (for create actions)"),
    threadId: z
      .string()
      .optional()
      .describe("The thread ID (for modify/add-member/get-messages)"),
    messageId: z
      .string()
      .optional()
      .describe(
        "The message ID to create thread from (for create-from-message)",
      ),
    userId: z
      .string()
      .optional()
      .describe("The user ID to add (for add-member)"),
    name: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("Thread name (for create/modify)"),
    autoArchiveDuration: z
      .enum(["60", "1440", "4320", "10080"])
      .optional()
      .describe(
        "Auto-archive after minutes (60=1h, 1440=1d, 4320=3d, 10080=7d)",
      ),
    message: z
      .string()
      .optional()
      .describe("Initial message content (for create-standalone)"),
    type: z
      .enum(["public", "private"])
      .optional()
      .describe("Thread type (for create-standalone)"),
    archived: z
      .boolean()
      .optional()
      .describe("Whether to archive (for modify)"),
    locked: z.boolean().optional().describe("Whether to lock (for modify)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Number of messages to fetch (for get-messages)"),
    before: z
      .string()
      .optional()
      .describe("Fetch messages before this ID (for get-messages pagination)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          threadId: z.string(),
          threadName: z.string(),
        }),
        z.object({
          messages: z.array(
            z.object({
              id: z.string(),
              authorId: z.string(),
              authorName: z.string(),
              isBot: z.boolean(),
              content: z.string(),
              createdAt: z.string(),
            }),
          ),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-thread", undefined, async () => {
      try {
        // Validate all Discord IDs before making API calls
        const idError = validateSnowflakes([
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.threadId, fieldName: "threadId" },
          { value: ctx.messageId, fieldName: "messageId" },
          { value: ctx.userId, fieldName: "userId" },
          { value: ctx.before, fieldName: "before" },
        ]);
        if (idError != null && idError.length > 0) {
          return { success: false, message: idError };
        }

        const client = getDiscordClient();

        switch (ctx.action) {
          case "create-from-message":
            return await handleCreateFromMessage(
              client,
              ctx.channelId,
              ctx.messageId,
              ctx.name,
              ctx.autoArchiveDuration,
            );
          case "create-standalone":
            return await handleCreateStandalone(
              client,
              ctx.channelId,
              ctx.name,
              ctx.autoArchiveDuration,
              ctx.type,
              ctx.message,
            );
          case "modify":
            return await handleModifyThread(
              client,
              ctx.threadId,
              ctx.name,
              ctx.archived,
              ctx.locked,
              ctx.autoArchiveDuration,
            );
          case "add-member":
            return await handleAddMember(client, ctx.threadId, ctx.userId);
          case "get-messages":
            return await handleGetThreadMessages(
              client,
              ctx.threadId,
              ctx.limit,
              ctx.before,
            );
        }
      } catch (error) {
        logger.error("Failed to manage thread", error);
        captureException(error as Error, { operation: "tool.manage-thread" });
        return {
          success: false,
          message: `Failed to manage thread: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const threadTools = [manageThreadTool];
