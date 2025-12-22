import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import type { TextChannel, User } from "discord.js";

export const sendMessageTool = createTool({
  id: "send-message",
  description: "Send a message to a Discord channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel to send the message to"),
    content: z.string().describe("The message content to send"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        messageId: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const sentMessage = await (channel as TextChannel).send(input.content);

      return {
        success: true,
        message: "Message sent successfully",
        data: {
          messageId: sentMessage.id,
        },
      };
    } catch (error) {
      logger.error("Failed to send message", { error, channelId: input.channelId });
      return {
        success: false,
        message: "Failed to send message",
      };
    }
  },
});

export const sendDirectMessageTool = createTool({
  id: "send-direct-message",
  description: "Send a direct message (DM) to a Discord user. Use this to privately message a user.",
  inputSchema: z.object({
    userId: z.string().describe("The ID of the user to send the DM to"),
    content: z.string().describe("The message content to send"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        messageId: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      logger.debug("Attempting to send DM", { userId: input.userId });

      const user = await client.users.fetch(input.userId) as User;
      if (!user) {
        logger.warn("User not found for DM", { userId: input.userId });
        return {
          success: false,
          message: "User not found",
        };
      }

      const dmChannel = await user.createDM();
      const sentMessage = await dmChannel.send(input.content);

      logger.info("DM sent successfully", { userId: input.userId, messageId: sentMessage.id });
      return {
        success: true,
        message: "Direct message sent successfully",
        data: {
          messageId: sentMessage.id,
        },
      };
    } catch (error) {
      logger.error("Failed to send direct message", { error, userId: input.userId });
      return {
        success: false,
        message: "Failed to send direct message. The user may have DMs disabled or blocked the bot.",
      };
    }
  },
});

export const deleteMessageTool = createTool({
  id: "delete-message",
  description: "Delete a message from a Discord channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(
        input.messageId,
      );
      await message.delete();

      return {
        success: true,
        message: "Message deleted successfully",
      };
    } catch (error) {
      logger.error("Failed to delete message", error);
      return {
        success: false,
        message: "Failed to delete message",
      };
    }
  },
});

export const pinMessageTool = createTool({
  id: "pin-message",
  description: "Pin a message in a Discord channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message to pin"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(
        input.messageId,
      );
      await message.pin();

      return {
        success: true,
        message: "Message pinned successfully",
      };
    } catch (error) {
      logger.error("Failed to pin message", error);
      return {
        success: false,
        message: "Failed to pin message",
      };
    }
  },
});

export const editMessageTool = createTool({
  id: "edit-message",
  description: "Edit a message sent by the bot",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message to edit"),
    content: z.string().describe("The new message content"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(input.messageId);
      await message.edit(input.content);

      return {
        success: true,
        message: "Message edited successfully",
      };
    } catch (error) {
      logger.error("Failed to edit message", error);
      return {
        success: false,
        message: "Failed to edit message",
      };
    }
  },
});

export const bulkDeleteMessagesTool = createTool({
  id: "bulk-delete-messages",
  description: "Delete multiple messages at once (max 100, messages must be less than 14 days old)",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
    messageIds: z.array(z.string()).describe("Array of message IDs to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      await (channel as TextChannel).bulkDelete(input.messageIds);

      return {
        success: true,
        message: `Deleted ${String(input.messageIds.length)} messages`,
      };
    } catch (error) {
      logger.error("Failed to bulk delete messages", error);
      return {
        success: false,
        message: "Failed to bulk delete messages",
      };
    }
  },
});

export const unpinMessageTool = createTool({
  id: "unpin-message",
  description: "Unpin a message from a Discord channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message to unpin"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(input.messageId);
      await message.unpin();

      return {
        success: true,
        message: "Message unpinned successfully",
      };
    } catch (error) {
      logger.error("Failed to unpin message", error);
      return {
        success: false,
        message: "Failed to unpin message",
      };
    }
  },
});

export const addReactionTool = createTool({
  id: "add-reaction",
  description: "Add a reaction to a message",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message"),
    emoji: z.string().describe("The emoji to react with (Unicode or custom emoji ID)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(input.messageId);
      await message.react(input.emoji);

      return {
        success: true,
        message: "Reaction added successfully",
      };
    } catch (error) {
      logger.error("Failed to add reaction", error);
      return {
        success: false,
        message: "Failed to add reaction",
      };
    }
  },
});

export const removeReactionTool = createTool({
  id: "remove-reaction",
  description: "Remove a reaction from a message",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the message"),
    messageId: z.string().describe("The ID of the message"),
    emoji: z.string().describe("The emoji to remove"),
    userId: z.string().optional().describe("The user ID to remove reaction from (defaults to bot)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const message = await (channel as TextChannel).messages.fetch(input.messageId);
      const reaction = message.reactions.cache.get(input.emoji);

      if (!reaction) {
        return {
          success: false,
          message: "Reaction not found",
        };
      }

      if (input.userId) {
        await reaction.users.remove(input.userId);
      } else {
        await reaction.users.remove();
      }

      return {
        success: true,
        message: "Reaction removed successfully",
      };
    } catch (error) {
      logger.error("Failed to remove reaction", error);
      return {
        success: false,
        message: "Failed to remove reaction",
      };
    }
  },
});

export const getChannelMessagesTool = createTool({
  id: "get-channel-messages",
  description: "Fetch recent messages from a channel. Use this to see conversation history, find specific messages, or get context about what was discussed.",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel to fetch messages from"),
    limit: z.number().min(1).max(100).optional().describe("Number of messages to fetch (default: 20, max: 100)"),
    before: z.string().optional().describe("Fetch messages before this message ID"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        messages: z.array(
          z.object({
            id: z.string(),
            authorId: z.string(),
            authorName: z.string(),
            isBot: z.boolean(),
            content: z.string(),
            createdAt: z.string(),
          })
        ),
      })
      .optional(),
  }),
  execute: async (input) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(input.channelId);

      if (!channel?.isTextBased()) {
        return {
          success: false,
          message: "Channel is not a text channel",
        };
      }

      const messages = await (channel as TextChannel).messages.fetch({
        limit: input.limit ?? 20,
        ...(input.before && { before: input.before }),
      });

      const formattedMessages = messages
        .map((msg) => ({
          id: msg.id,
          authorId: msg.author.id,
          authorName: msg.author.displayName || msg.author.username,
          isBot: msg.author.bot,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
        }))
        .reverse(); // Chronological order

      return {
        success: true,
        message: `Fetched ${String(formattedMessages.length)} messages`,
        data: {
          messages: formattedMessages,
        },
      };
    } catch (error) {
      logger.error("Failed to fetch messages", error);
      return {
        success: false,
        message: "Failed to fetch messages",
      };
    }
  },
});

export const messageTools = [
  sendMessageTool,
  sendDirectMessageTool,
  deleteMessageTool,
  pinMessageTool,
  editMessageTool,
  bulkDeleteMessagesTool,
  unpinMessageTool,
  addReactionTool,
  removeReactionTool,
  getChannelMessagesTool,
];
