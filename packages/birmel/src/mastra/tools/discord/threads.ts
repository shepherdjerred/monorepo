import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { validateSnowflakes } from "./validation.ts";
import {
  handleCreateFromMessage,
  handleCreateStandalone,
  handleModifyThread,
  handleAddMember,
  handleGetThreadMessages,
} from "./thread-actions.ts";

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
            return await handleCreateFromMessage({
              client,
              channelId: ctx.channelId,
              messageId: ctx.messageId,
              name: ctx.name,
              autoArchiveDuration: ctx.autoArchiveDuration,
            });
          case "create-standalone":
            return await handleCreateStandalone({
              client,
              channelId: ctx.channelId,
              name: ctx.name,
              autoArchiveDurationStr: ctx.autoArchiveDuration,
              type: ctx.type,
              messageContent: ctx.message,
            });
          case "modify":
            return await handleModifyThread({
              client,
              threadId: ctx.threadId,
              name: ctx.name,
              archived: ctx.archived,
              locked: ctx.locked,
              autoArchiveDuration: ctx.autoArchiveDuration,
            });
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
        captureException(toError(error), { operation: "tool.manage-thread" });
        return {
          success: false,
          message: `Failed to manage thread: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const threadTools = [manageThreadTool];
