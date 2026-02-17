import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { ChannelType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "../../../observability/index.js";
import { validateSnowflakes } from "./validation.js";

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
          case "create-from-message": {
            if (!ctx.channelId || !ctx.messageId || !ctx.name) {
              return {
                success: false,
                message:
                  "channelId, messageId, and name are required for create-from-message",
              };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (channel?.isTextBased() !== true) {
              return {
                success: false,
                message: "Channel must be a text channel to create threads",
              };
            }
            const message = await channel.messages.fetch(ctx.messageId);
            const thread = await message.startThread({
              name: ctx.name,
              autoArchiveDuration: ctx.autoArchiveDuration != null && ctx.autoArchiveDuration.length > 0
                ? (Number.parseInt(ctx.autoArchiveDuration) as
                    | 60
                    | 1440
                    | 4320
                    | 10_080)
                : 1440,
            });
            logger.info("Thread created from message", { threadId: thread.id });
            return {
              success: true,
              message: `Thread "${ctx.name}" created successfully`,
              data: { threadId: thread.id, threadName: thread.name },
            };
          }

          case "create-standalone": {
            if (!ctx.channelId || !ctx.name) {
              return {
                success: false,
                message:
                  "channelId and name are required for create-standalone",
              };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased() || !("threads" in channel)) {
              return {
                success: false,
                message: "Channel must support threads",
              };
            }
            const autoArchiveDuration = ctx.autoArchiveDuration != null && ctx.autoArchiveDuration.length > 0
              ? (Number.parseInt(ctx.autoArchiveDuration) as
                  | 60
                  | 1440
                  | 4320
                  | 10_080)
              : 1440;
            const threadType =
              ctx.type === "private"
                ? ChannelType.PrivateThread
                : ChannelType.PublicThread;
            const thread = await channel.threads.create({
              name: ctx.name,
              autoArchiveDuration,
              // @ts-expect-error - ChannelType enum complexity with Discord.js types
              type: threadType,
              ...(ctx.message != null && ctx.message.length > 0 && { message: { content: ctx.message } }),
            });
            logger.info("Standalone thread created", { threadId: thread.id });
            return {
              success: true,
              message: `Thread "${ctx.name}" created successfully`,
              data: { threadId: thread.id, threadName: thread.name },
            };
          }

          case "modify": {
            if (ctx.threadId == null || ctx.threadId.length === 0) {
              return {
                success: false,
                message: "threadId is required for modify",
              };
            }
            const thread = await client.channels.fetch(ctx.threadId);
            if (thread?.isThread() !== true) {
              return {
                success: false,
                message: "Channel is not a thread",
              };
            }
            const updates: {
              name?: string;
              archived?: boolean;
              locked?: boolean;
              autoArchiveDuration?: 60 | 1440 | 4320 | 10_080;
            } = {};
            if (ctx.name !== undefined) {
              updates.name = ctx.name;
            }
            if (ctx.archived !== undefined) {
              updates.archived = ctx.archived;
            }
            if (ctx.locked !== undefined) {
              updates.locked = ctx.locked;
            }
            if (ctx.autoArchiveDuration !== undefined) {
              updates.autoArchiveDuration = Number.parseInt(
                ctx.autoArchiveDuration,
              ) as 60 | 1440 | 4320 | 10_080;
            }
            if (Object.keys(updates).length === 0) {
              return {
                success: false,
                message: "At least one field must be provided to modify",
              };
            }
            await thread.edit(updates);
            logger.info("Thread modified", { threadId: ctx.threadId });
            return {
              success: true,
              message: `Thread updated successfully (modified: ${Object.keys(updates).join(", ")})`,
            };
          }

          case "add-member": {
            if (!ctx.threadId || !ctx.userId) {
              return {
                success: false,
                message: "threadId and userId are required for add-member",
              };
            }
            const thread = await client.channels.fetch(ctx.threadId);
            if (thread?.isThread() !== true) {
              return {
                success: false,
                message: "Channel is not a thread",
              };
            }
            await thread.members.add(ctx.userId);
            logger.info("Member added to thread", {
              threadId: ctx.threadId,
              userId: ctx.userId,
            });
            return {
              success: true,
              message: "User added to thread successfully",
            };
          }

          case "get-messages": {
            if (ctx.threadId == null || ctx.threadId.length === 0) {
              return {
                success: false,
                message: "threadId is required for get-messages",
              };
            }
            const thread = await client.channels.fetch(ctx.threadId);
            if (thread?.isThread() !== true) {
              return {
                success: false,
                message: "Channel is not a thread",
              };
            }
            const fetchOptions: { limit: number; before?: string } = {
              limit: ctx.limit ?? 20,
            };
            if (ctx.before != null && ctx.before.length > 0) {
              fetchOptions.before = ctx.before;
            }
            const messages = await thread.messages.fetch(fetchOptions);
            const formattedMessages = [...messages.values()].map((msg) => ({
              id: msg.id,
              authorId: msg.author.id,
              authorName: msg.author.username,
              isBot: msg.author.bot,
              content: msg.content,
              createdAt: msg.createdAt.toISOString(),
            }));
            logger.info("Thread messages fetched", {
              threadId: ctx.threadId,
              count: formattedMessages.length,
            });
            return {
              success: true,
              message: `Retrieved ${formattedMessages.length.toString()} messages from thread`,
              data: { messages: formattedMessages },
            };
          }
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
