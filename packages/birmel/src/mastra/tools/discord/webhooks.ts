import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";

export const manageWebhookTool = createTool({
  id: "manage-webhook",
  description: "Manage webhooks: list all, create new, modify, delete, or execute (send message)",
  inputSchema: z.object({
    action: z.enum(["list", "create", "modify", "delete", "execute"]).describe("The action to perform"),
    guildId: z.string().optional().describe("The ID of the guild (required for list)"),
    channelId: z.string().optional().describe("The ID of the channel (for list filtering or create)"),
    webhookId: z.string().optional().describe("The ID of the webhook (required for modify/delete/execute)"),
    webhookToken: z.string().optional().describe("The webhook token (required for execute)"),
    name: z.string().optional().describe("Name for the webhook (required for create, optional for modify)"),
    avatarUrl: z.string().optional().describe("Avatar URL for the webhook (for modify)"),
    content: z.string().optional().describe("Message content (for execute)"),
    username: z.string().optional().describe("Override username (for execute)"),
    reason: z.string().optional().describe("Reason for creating/modifying/deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            id: z.string(),
            name: z.string().nullable(),
            channelId: z.string(),
            url: z.string(),
          }),
        ),
        z.object({
          webhookId: z.string(),
          webhookUrl: z.string(),
        }),
        z.object({
          messageId: z.string(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.channelId, fieldName: "channelId" },
        { value: ctx.webhookId, fieldName: "webhookId" },
      ]);
      if (idError) return { success: false, message: idError };

      const client = getDiscordClient();

      switch (ctx.action) {
        case "list": {
          if (!ctx.guildId) {
            return {
              success: false,
              message: "guildId is required for listing webhooks",
            };
          }
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
        }

        case "create": {
          if (!ctx.channelId || !ctx.name) {
            return {
              success: false,
              message: "channelId and name are required for creating a webhook",
            };
          }
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
        }

        case "modify": {
          if (!ctx.webhookId) {
            return {
              success: false,
              message: "webhookId is required for modifying a webhook",
            };
          }
          const webhook = await client.fetchWebhook(ctx.webhookId);
          const hasChanges =
            ctx.name !== undefined || ctx.avatarUrl !== undefined || ctx.channelId !== undefined;
          if (!hasChanges) {
            return {
              success: false,
              message: "No changes specified",
            };
          }
          const editOptions: Parameters<typeof webhook.edit>[0] = {};
          if (ctx.name !== undefined) editOptions.name = ctx.name;
          if (ctx.avatarUrl !== undefined) editOptions.avatar = ctx.avatarUrl;
          if (ctx.channelId !== undefined) editOptions.channel = ctx.channelId;
          if (ctx.reason !== undefined) editOptions.reason = ctx.reason;
          await webhook.edit(editOptions);
          return {
            success: true,
            message: `Updated webhook "${webhook.name}"`,
          };
        }

        case "delete": {
          if (!ctx.webhookId) {
            return {
              success: false,
              message: "webhookId is required for deleting a webhook",
            };
          }
          const webhook = await client.fetchWebhook(ctx.webhookId);
          const webhookName = webhook.name;
          await webhook.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted webhook "${webhookName}"`,
          };
        }

        case "execute": {
          if (!ctx.webhookId || !ctx.webhookToken) {
            return {
              success: false,
              message: "webhookId and webhookToken are required for executing a webhook",
            };
          }
          if (!ctx.content) {
            return {
              success: false,
              message: "content is required for executing a webhook",
            };
          }
          const webhook = await client.fetchWebhook(ctx.webhookId, ctx.webhookToken);
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
        }
      }
    } catch (error) {
      logger.error("Failed to manage webhook", error);
      return {
        success: false,
        message: `Failed to manage webhook: ${(error as Error).message}`,
      };
    }
  },
});

export const webhookTools = [manageWebhookTool];
