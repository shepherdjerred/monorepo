import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { discordChannelName, validateSnowflakes } from "./validation.ts";
import {
  handleCreateFromMessage,
  handleCreateStandalone,
  handleGetThreadMessages,
  handleSummarizeThread,
} from "./actions/thread-actions.ts";
import { validateChannelsInRequestGuild } from "./channel-resolver.ts";

const logger = loggers.tools.child("discord.threads");

export const manageThreadTool = createTool({
  id: "manage-thread",
  description:
    "Create Discord threads in this server, read their messages, or summarize them. Use manage-message with the thread ID to post into a thread.",
  inputSchema: z.object({
    action: z
      .enum([
        "create-from-message",
        "create-standalone",
        "get-messages",
        "summarize",
      ])
      .describe(
        "The action to perform. 'create-from-message' moves a conversation into a thread. 'summarize' summarizes thread history. Use manage-message to post into a thread.",
      ),
    channelId: z
      .string()
      .optional()
      .describe("The channel ID (for create actions)"),
    threadId: z
      .string()
      .optional()
      .describe("The thread ID (for get-messages/summarize)"),
    messageId: z
      .string()
      .optional()
      .describe(
        "The message ID to create thread from (for create-from-message)",
      ),
    name: discordChannelName.optional().describe("Thread name (for create)"),
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
    data: z.unknown().optional(),
  }),
  preflight: async (ctx, { signal }) => {
    signal.throwIfAborted();
    const idError = validateSnowflakes([
      { value: ctx.channelId, fieldName: "channelId" },
      { value: ctx.threadId, fieldName: "threadId" },
      { value: ctx.messageId, fieldName: "messageId" },
      { value: ctx.before, fieldName: "before" },
    ]);
    if (idError != null) {
      return { success: false, message: idError };
    }
    const targetError = await validateChannelsInRequestGuild(
      getDiscordClient(),
      [ctx.channelId, ctx.threadId],
    );
    signal.throwIfAborted();
    return targetError == null
      ? undefined
      : { success: false, message: targetError };
  },
  execute: async (ctx) => {
    return withToolSpan("manage-thread", undefined, async () => {
      try {
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
          case "get-messages":
            return await handleGetThreadMessages(
              client,
              ctx.threadId,
              ctx.limit,
              ctx.before,
            );
          case "summarize":
            return await handleSummarizeThread(
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
