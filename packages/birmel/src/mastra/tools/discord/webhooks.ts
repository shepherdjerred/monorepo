import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const listWebhooksTool = createTool({
  id: "list-webhooks",
  description: "List all webhooks in a channel or server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().optional().describe("Channel ID to filter webhooks"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().nullable(),
          channelId: z.string(),
          url: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      let webhooks;
      if (ctx.channelId) {
        const channel = await client.channels.fetch(ctx.channelId);
        if (!channel?.isTextBased() || !("fetchWebhooks" in channel)) {
          return {
            success: false,
            message: "Channel does not support webhooks",
          };
        }
        webhooks = await (channel as TextChannel).fetchWebhooks();
      } else {
        webhooks = await guild.fetchWebhooks();
      }

      const webhookList = webhooks.map((webhook) => ({
        id: webhook.id,
        name: webhook.name,
        channelId: webhook.channelId,
        url: webhook.url,
      }));

      return {
        success: true,
        message: `Found ${String(webhookList.length)} webhooks`,
        data: webhookList,
      };
    } catch (error) {
      logger.error("Failed to list webhooks", error);
      return {
        success: false,
        message: "Failed to list webhooks",
      };
    }
  },
});

export const createWebhookTool = createTool({
  id: "create-webhook",
  description: "Create a new webhook in a channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
    name: z.string().describe("Name for the webhook"),
    reason: z.string().optional().describe("Reason for creating"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        webhookId: z.string(),
        webhookUrl: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased() || !("createWebhook" in channel)) {
        return {
          success: false,
          message: "Channel does not support webhooks",
        };
      }

      const webhook = await (channel as TextChannel).createWebhook({
        name: ctx.name,
        ...(ctx.reason !== undefined && { reason: ctx.reason }),
      });

      return {
        success: true,
        message: `Created webhook "${webhook.name}"`,
        data: {
          webhookId: webhook.id,
          webhookUrl: webhook.url,
        },
      };
    } catch (error) {
      logger.error("Failed to create webhook", error);
      return {
        success: false,
        message: "Failed to create webhook",
      };
    }
  },
});

export const deleteWebhookTool = createTool({
  id: "delete-webhook",
  description: "Delete a webhook",
  inputSchema: z.object({
    webhookId: z.string().describe("The ID of the webhook"),
    reason: z.string().optional().describe("Reason for deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const webhook = await client.fetchWebhook(ctx.webhookId);

      const webhookName = webhook.name;
      await webhook.delete(ctx.reason);

      return {
        success: true,
        message: `Deleted webhook "${webhookName}"`,
      };
    } catch (error) {
      logger.error("Failed to delete webhook", error);
      return {
        success: false,
        message: "Failed to delete webhook",
      };
    }
  },
});

export const modifyWebhookTool = createTool({
  id: "modify-webhook",
  description: "Modify a webhook's name or avatar",
  inputSchema: z.object({
    webhookId: z.string().describe("The ID of the webhook"),
    name: z.string().optional().describe("New name for the webhook"),
    avatarUrl: z.string().optional().describe("New avatar URL for the webhook"),
    channelId: z.string().optional().describe("New channel ID to move the webhook to"),
    reason: z.string().optional().describe("Reason for modifying"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const webhook = await client.fetchWebhook(ctx.webhookId);

      const editOptions: Parameters<typeof webhook.edit>[0] = {};
      if (ctx.name !== undefined) editOptions.name = ctx.name;
      if (ctx.avatarUrl !== undefined) editOptions.avatar = ctx.avatarUrl;
      if (ctx.channelId !== undefined) editOptions.channel = ctx.channelId;
      if (ctx.reason !== undefined) editOptions.reason = ctx.reason;

      const hasChanges =
        ctx.name !== undefined ||
        ctx.avatarUrl !== undefined ||
        ctx.channelId !== undefined;

      if (!hasChanges) {
        return {
          success: false,
          message: "No changes specified",
        };
      }

      await webhook.edit(editOptions);

      return {
        success: true,
        message: `Updated webhook "${webhook.name}"`,
      };
    } catch (error) {
      logger.error("Failed to modify webhook", error);
      return {
        success: false,
        message: "Failed to modify webhook",
      };
    }
  },
});

export const executeWebhookTool = createTool({
  id: "execute-webhook",
  description: "Send a message via a webhook",
  inputSchema: z.object({
    webhookId: z.string().describe("The ID of the webhook"),
    webhookToken: z.string().describe("The webhook token"),
    content: z.string().optional().describe("Message content"),
    username: z.string().optional().describe("Override the webhook's username"),
    avatarUrl: z.string().optional().describe("Override the webhook's avatar URL"),
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
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const webhook = await client.fetchWebhook(ctx.webhookId, ctx.webhookToken);

      if (!ctx.content) {
        return {
          success: false,
          message: "Message content is required",
        };
      }

      const sentMessage = await webhook.send({
        content: ctx.content,
        ...(ctx.username !== undefined && { username: ctx.username }),
        ...(ctx.avatarUrl !== undefined && { avatarURL: ctx.avatarUrl }),
      });

      return {
        success: true,
        message: "Webhook message sent",
        data: {
          messageId: sentMessage.id,
        },
      };
    } catch (error) {
      logger.error("Failed to execute webhook", error);
      return {
        success: false,
        message: "Failed to execute webhook",
      };
    }
  },
});

export const webhookTools = [
  listWebhooksTool,
  createWebhookTool,
  modifyWebhookTool,
  deleteWebhookTool,
  executeWebhookTool,
];
