import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/index.js";
import { logger } from "@shepherdjerred/birmel/utils/logger.js";
import { validateSnowflakes } from "./validation.ts";
import {
  handleListWebhooks,
  handleCreateWebhook,
  handleModifyWebhook,
  handleDeleteWebhook,
  handleExecuteWebhook,
} from "./webhook-actions.ts";

export const manageWebhookTool = createTool({
  id: "manage-webhook",
  description:
    "Manage webhooks: list all, create new, modify, delete, or execute (send message)",
  inputSchema: z.object({
    action: z
      .enum(["list", "create", "modify", "delete", "execute"])
      .describe("The action to perform"),
    guildId: z
      .string()
      .optional()
      .describe("The ID of the guild (required for list)"),
    channelId: z
      .string()
      .optional()
      .describe("The ID of the channel (for list filtering or create)"),
    webhookId: z
      .string()
      .optional()
      .describe("The ID of the webhook (required for modify/delete/execute)"),
    webhookToken: z
      .string()
      .optional()
      .describe("The webhook token (required for execute)"),
    name: z
      .string()
      .optional()
      .describe(
        "Name for the webhook (required for create, optional for modify)",
      ),
    avatarUrl: z
      .string()
      .optional()
      .describe("Avatar URL for the webhook (for modify)"),
    content: z.string().optional().describe("Message content (for execute)"),
    username: z.string().optional().describe("Override username (for execute)"),
    reason: z
      .string()
      .optional()
      .describe("Reason for creating/modifying/deleting"),
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
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      const client = getDiscordClient();

      switch (ctx.action) {
        case "list":
          return await handleListWebhooks(client, ctx.guildId, ctx.channelId);
        case "create":
          return await handleCreateWebhook(
            client,
            ctx.channelId,
            ctx.name,
            ctx.reason,
          );
        case "modify":
          return await handleModifyWebhook(
            client,
            ctx.webhookId,
            ctx.name,
            ctx.avatarUrl,
            ctx.channelId,
            ctx.reason,
          );
        case "delete":
          return await handleDeleteWebhook(client, ctx.webhookId, ctx.reason);
        case "execute":
          return await handleExecuteWebhook(
            client,
            ctx.webhookId,
            ctx.webhookToken,
            ctx.content,
            ctx.username,
            ctx.avatarUrl,
          );
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
