import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import type { TextChannel } from "discord.js";

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
      logger.error("Failed to send message", error);
      return {
        success: false,
        message: "Failed to send message",
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

export const messageTools = [
  sendMessageTool,
  deleteMessageTool,
  pinMessageTool,
  editMessageTool,
  bulkDeleteMessagesTool,
  unpinMessageTool,
  addReactionTool,
  removeReactionTool,
];
