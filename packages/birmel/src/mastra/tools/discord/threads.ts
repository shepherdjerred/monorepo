import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ChannelType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";

const logger = loggers.tools.child("discord.threads");

export const createThreadFromMessageTool = createTool({
  id: "create-thread-from-message",
  description: "Create a discussion thread from an existing message in a channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message to start the thread from"),
    name: z.string().min(1).max(100).describe("Thread name (1-100 characters)"),
    autoArchiveDuration: z.enum(["60", "1440", "4320", "10080"]).optional()
      .describe("Auto-archive after minutes of inactivity (60=1h, 1440=1d, 4320=3d, 10080=7d, default: 1440)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      threadId: z.string(),
      threadName: z.string()
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("create-thread-from-message", undefined, async () => {
      logger.debug("Creating thread from message", {
        channelId: ctx.context.channelId,
        messageId: ctx.context.messageId
      });
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.context.channelId);

        if (!channel?.isTextBased()) {
          return {
            success: false,
            message: "Channel must be a text channel to create threads"
          };
        }

        const message = await channel.messages.fetch(ctx.context.messageId);

        const thread = await message.startThread({
          name: ctx.context.name,
          autoArchiveDuration: ctx.context.autoArchiveDuration ? parseInt(ctx.context.autoArchiveDuration) as 60 | 1440 | 4320 | 10080 : 1440
        });

        logger.info("Thread created from message", {
          threadId: thread.id,
          messageId: ctx.context.messageId,
          channelId: ctx.context.channelId
        });

        return {
          success: true,
          message: `Thread "${ctx.context.name}" created successfully`,
          data: {
            threadId: thread.id,
            threadName: thread.name
          }
        };
      } catch (error) {
        logger.error("Failed to create thread from message", error, {
          channelId: ctx.context.channelId,
          messageId: ctx.context.messageId
        });
        captureException(error as Error, {
          operation: "tool.create-thread-from-message",
          discord: { channelId: ctx.context.channelId, messageId: ctx.context.messageId }
        });
        return {
          success: false,
          message: `Failed to create thread: ${(error as Error).message}`
        };
      }
    });
  }
});

export const createStandaloneThreadTool = createTool({
  id: "create-standalone-thread",
  description: "Create a standalone thread in a channel without a parent message",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel to create the thread in"),
    name: z.string().min(1).max(100).describe("Thread name (1-100 characters)"),
    autoArchiveDuration: z.enum(["60", "1440", "4320", "10080"]).optional()
      .describe("Auto-archive after minutes (60=1h, 1440=1d, 4320=3d, 10080=7d, default: 1440)"),
    message: z.string().optional().describe("Optional initial message content for the thread"),
    type: z.enum(["public", "private"]).optional().describe("Thread type (default: public, private requires permissions)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      threadId: z.string(),
      threadName: z.string()
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("create-standalone-thread", undefined, async () => {
      logger.debug("Creating standalone thread", { channelId: ctx.context.channelId, name: ctx.context.name });
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.context.channelId);

        if (!channel?.isTextBased() || !("threads" in channel)) {
          return {
            success: false,
            message: "Channel must support threads"
          };
        }

        const autoArchiveDuration = ctx.context.autoArchiveDuration
          ? parseInt(ctx.context.autoArchiveDuration) as 60 | 1440 | 4320 | 10080
          : 1440;

        let thread;
        if (ctx.context.type === "private") {
          thread = await channel.threads.create({
            name: ctx.context.name,
            autoArchiveDuration,
            // Discord.js has complex conditional types that conflict with exactOptionalPropertyTypes
            // @ts-expect-error - ChannelType.PrivateThread inferred as 'never' due to Discord.js type complexity
            type: ChannelType.PrivateThread,
            ...(ctx.context.message && { message: { content: ctx.context.message } }),
          });
        } else {
          thread = await channel.threads.create({
            name: ctx.context.name,
            autoArchiveDuration,
            // Discord.js has complex conditional types that conflict with exactOptionalPropertyTypes
            // @ts-expect-error - ChannelType.PublicThread inferred as 'never' due to Discord.js type complexity
            type: ChannelType.PublicThread,
            ...(ctx.context.message && { message: { content: ctx.context.message } }),
          });
        }

        logger.info("Standalone thread created", {
          threadId: thread.id,
          channelId: ctx.context.channelId,
          type: ctx.context.type ?? "public"
        });

        return {
          success: true,
          message: `Thread "${ctx.context.name}" created successfully`,
          data: {
            threadId: thread.id,
            threadName: thread.name
          }
        };
      } catch (error) {
        logger.error("Failed to create standalone thread", error, { channelId: ctx.context.channelId });
        captureException(error as Error, {
          operation: "tool.create-standalone-thread",
          discord: { channelId: ctx.context.channelId }
        });
        return {
          success: false,
          message: `Failed to create thread: ${(error as Error).message}`
        };
      }
    });
  }
});

export const modifyThreadTool = createTool({
  id: "modify-thread",
  description: "Modify thread settings including name, archived state, locked state, and auto-archive duration",
  inputSchema: z.object({
    threadId: z.string().describe("The ID of the thread to modify"),
    name: z.string().min(1).max(100).optional().describe("New thread name"),
    archived: z.boolean().optional().describe("Whether the thread should be archived (closes thread but keeps visible)"),
    locked: z.boolean().optional().describe("Whether the thread should be locked (prevents new messages)"),
    autoArchiveDuration: z.enum(["60", "1440", "4320", "10080"]).optional()
      .describe("New auto-archive duration in minutes")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (ctx) => {
    return withToolSpan("modify-thread", undefined, async () => {
      logger.debug("Modifying thread", { threadId: ctx.context.threadId });
      try {
        const client = getDiscordClient();
        const thread = await client.channels.fetch(ctx.context.threadId);

        if (!thread?.isThread()) {
          return {
            success: false,
            message: "Channel is not a thread"
          };
        }

        const updates: {
          name?: string;
          archived?: boolean;
          locked?: boolean;
          autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
        } = {};

        if (ctx.context.name !== undefined) updates.name = ctx.context.name;
        if (ctx.context.archived !== undefined) updates.archived = ctx.context.archived;
        if (ctx.context.locked !== undefined) updates.locked = ctx.context.locked;
        if (ctx.context.autoArchiveDuration !== undefined) {
          updates.autoArchiveDuration = parseInt(ctx.context.autoArchiveDuration) as 60 | 1440 | 4320 | 10080;
        }

        if (Object.keys(updates).length === 0) {
          return {
            success: false,
            message: "At least one field must be provided to modify"
          };
        }

        await thread.edit(updates);

        const changes = Object.keys(updates).join(", ");
        logger.info("Thread modified", { threadId: ctx.context.threadId, changes });

        return {
          success: true,
          message: `Thread updated successfully (modified: ${changes})`
        };
      } catch (error) {
        logger.error("Failed to modify thread", error, { threadId: ctx.context.threadId });
        captureException(error as Error, {
          operation: "tool.modify-thread",
          discord: { threadId: ctx.context.threadId }
        });
        return {
          success: false,
          message: `Failed to modify thread: ${(error as Error).message}`
        };
      }
    });
  }
});

export const addThreadMemberTool = createTool({
  id: "add-thread-member",
  description: "Add a user to a thread, allowing them to see and participate in it",
  inputSchema: z.object({
    threadId: z.string().describe("The ID of the thread"),
    userId: z.string().describe("The ID of the user to add to the thread")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (ctx) => {
    return withToolSpan("add-thread-member", undefined, async () => {
      logger.debug("Adding member to thread", { threadId: ctx.context.threadId, userId: ctx.context.userId });
      try {
        const client = getDiscordClient();
        const thread = await client.channels.fetch(ctx.context.threadId);

        if (!thread?.isThread()) {
          return {
            success: false,
            message: "Channel is not a thread"
          };
        }

        await thread.members.add(ctx.context.userId);

        logger.info("Member added to thread", { threadId: ctx.context.threadId, userId: ctx.context.userId });

        return {
          success: true,
          message: "User added to thread successfully"
        };
      } catch (error) {
        logger.error("Failed to add member to thread", error, {
          threadId: ctx.context.threadId,
          userId: ctx.context.userId
        });
        captureException(error as Error, {
          operation: "tool.add-thread-member",
          discord: { threadId: ctx.context.threadId, userId: ctx.context.userId }
        });
        return {
          success: false,
          message: `Failed to add user to thread: ${(error as Error).message}`
        };
      }
    });
  }
});

export const getThreadMessagesTool = createTool({
  id: "get-thread-messages",
  description: "Fetch messages from a thread channel with pagination support",
  inputSchema: z.object({
    threadId: z.string().describe("The ID of the thread to fetch messages from"),
    limit: z.number().min(1).max(100).optional().describe("Number of messages to fetch (default: 20, max: 100)"),
    before: z.string().optional().describe("Fetch messages before this message ID (for pagination)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      messages: z.array(z.object({
        id: z.string(),
        authorId: z.string(),
        authorName: z.string(),
        isBot: z.boolean(),
        content: z.string(),
        createdAt: z.string().describe("ISO timestamp")
      }))
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("get-thread-messages", undefined, async () => {
      logger.debug("Fetching thread messages", { threadId: ctx.context.threadId, limit: ctx.context.limit });
      try {
        const client = getDiscordClient();
        const thread = await client.channels.fetch(ctx.context.threadId);

        if (!thread?.isThread()) {
          return {
            success: false,
            message: "Channel is not a thread"
          };
        }

        const fetchOptions: { limit: number; before?: string } = {
          limit: ctx.context.limit ?? 20
        };

        if (ctx.context.before) {
          fetchOptions.before = ctx.context.before;
        }

        const messages = await thread.messages.fetch(fetchOptions);

        const formattedMessages = Array.from(messages.values()).map(msg => ({
          id: msg.id,
          authorId: msg.author.id,
          authorName: msg.author.username,
          isBot: msg.author.bot,
          content: msg.content,
          createdAt: msg.createdAt.toISOString()
        }));

        logger.info("Thread messages fetched", {
          threadId: ctx.context.threadId,
          count: formattedMessages.length
        });

        return {
          success: true,
          message: `Retrieved ${formattedMessages.length.toString()} messages from thread`,
          data: {
            messages: formattedMessages
          }
        };
      } catch (error) {
        logger.error("Failed to fetch thread messages", error, { threadId: ctx.context.threadId });
        captureException(error as Error, {
          operation: "tool.get-thread-messages",
          discord: { threadId: ctx.context.threadId }
        });
        return {
          success: false,
          message: `Failed to fetch thread messages: ${(error as Error).message}`
        };
      }
    });
  }
});

export const threadTools = [
  createThreadFromMessageTool,
  createStandaloneThreadTool,
  modifyThreadTool,
  addThreadMemberTool,
  getThreadMessagesTool
];
