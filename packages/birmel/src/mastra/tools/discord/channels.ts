import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";
import {
  withToolSpan,
  captureException,
} from "@shepherdjerred/birmel/observability/index.js";
import { validateSnowflakes } from "./validation.ts";
import { parseDiscordAPIError, formatDiscordAPIError } from "./error-utils.ts";
import {
  handleList,
  handleGet,
  handleCreate,
  handleModify,
  handleDelete,
  handleReorder,
  handleSetPermissions,
} from "./channel-actions.ts";

const logger = loggers.tools.child("discord.channels");

export const manageChannelTool = createTool({
  id: "manage-channel",
  description:
    "Manage Discord channels: list, get, create, modify, delete, reorder, or set permissions",
  inputSchema: z.object({
    action: z
      .enum([
        "list",
        "get",
        "create",
        "modify",
        "delete",
        "reorder",
        "set-permissions",
      ])
      .describe("The action to perform"),
    guildId: z
      .string()
      .optional()
      .describe("Guild ID (for list/create/reorder)"),
    channelId: z
      .string()
      .optional()
      .describe("Channel ID (for get/modify/delete/set-permissions)"),
    name: z.string().optional().describe("Channel name (for create/modify)"),
    type: z
      .enum(["text", "voice", "category"])
      .optional()
      .describe("Channel type (for create)"),
    parentId: z.string().nullable().optional().describe("Parent category ID"),
    topic: z.string().optional().describe("Channel topic"),
    position: z.number().optional().describe("Channel position"),
    positions: z
      .array(z.object({ channelId: z.string(), position: z.number() }))
      .optional()
      .describe("Positions array (for reorder)"),
    targetId: z
      .string()
      .optional()
      .describe("Role/user ID (for set-permissions)"),
    targetType: z
      .enum(["role", "member"])
      .optional()
      .describe("Target type (for set-permissions)"),
    allow: z.array(z.string()).optional().describe("Permissions to allow"),
    deny: z.array(z.string()).optional().describe("Permissions to deny"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            parentId: z.string().nullable(),
          }),
        ),
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          topic: z.string().nullable(),
          parentId: z.string().nullable(),
          position: z.number(),
        }),
        z.object({ channelId: z.string() }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-channel", ctx.guildId, async () => {
      try {
        const idError = validateSnowflakes([
          { value: ctx.guildId, fieldName: "guildId" },
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.parentId ?? undefined, fieldName: "parentId" },
          { value: ctx.targetId, fieldName: "targetId" },
        ]);
        if (idError != null && idError.length > 0) {
          return { success: false, message: idError };
        }

        if (ctx.positions != null) {
          for (const pos of ctx.positions) {
            const posError = validateSnowflakes([
              { value: pos.channelId, fieldName: "positions.channelId" },
            ]);
            if (posError != null && posError.length > 0) {
              return { success: false, message: posError };
            }
          }
        }

        const client = getDiscordClient();

        switch (ctx.action) {
          case "list":
            return await handleList(client, ctx.guildId);
          case "get":
            return await handleGet(client, ctx.channelId);
          case "create":
            return await handleCreate(
              client,
              ctx.guildId,
              ctx.name,
              ctx.type,
              ctx.parentId,
              ctx.topic,
            );
          case "modify":
            return await handleModify(
              client,
              ctx.channelId,
              ctx.name,
              ctx.topic,
              ctx.position,
              ctx.parentId,
            );
          case "delete":
            return await handleDelete(client, ctx.channelId, ctx.reason);
          case "reorder":
            return await handleReorder(client, ctx.guildId, ctx.positions);
          case "set-permissions":
            return await handleSetPermissions(
              client,
              ctx.channelId,
              ctx.targetId,
              ctx.allow,
              ctx.deny,
            );
        }
      } catch (error) {
        const apiError = parseDiscordAPIError(error);
        if (apiError != null) {
          logger.error("Discord API error in manage-channel", {
            code: apiError.code,
            status: apiError.status,
            message: apiError.message,
            method: apiError.method,
            url: apiError.url,
            ctx,
          });
          captureException(new Error(formatDiscordAPIError(apiError)), {
            operation: "tool.manage-channel",
          });
          return {
            success: false,
            message: formatDiscordAPIError(apiError),
          };
        }
        logger.error("Failed to manage channel", error);
        captureException(error as Error, { operation: "tool.manage-channel" });
        return {
          success: false,
          message: `Failed: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const channelTools = [manageChannelTool];
