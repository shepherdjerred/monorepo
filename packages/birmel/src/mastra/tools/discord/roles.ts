import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSnowflakes } from "./validation.ts";
import { parseDiscordAPIError, formatDiscordAPIError } from "./error-utils.ts";
import {
  handleListRoles,
  handleGetRole,
  handleCreateRole,
  handleModifyRole,
  handleDeleteRole,
  handleReorderRoles,
} from "./role-actions.ts";

export const manageRoleTool = createTool({
  id: "manage-role",
  description:
    "Manage roles in the server: list all, get details, create, modify, delete, or reorder",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["list", "get", "create", "modify", "delete", "reorder"])
      .describe("The action to perform"),
    roleId: z
      .string()
      .optional()
      .describe("The ID of the role (required for get/modify/delete)"),
    name: z
      .string()
      .optional()
      .describe("Name of the role (required for create, optional for modify)"),
    color: z.string().optional().describe("Hex color code (e.g., #FF0000)"),
    hoist: z
      .boolean()
      .optional()
      .describe("Whether to display separately in member list"),
    mentionable: z
      .boolean()
      .optional()
      .describe("Whether the role can be mentioned"),
    positions: z
      .array(
        z.object({
          roleId: z.string(),
          position: z.number(),
        }),
      )
      .optional()
      .describe(
        "Array of role IDs and their new positions (required for reorder)",
      ),
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
            color: z.string(),
            position: z.number(),
            memberCount: z.number(),
          }),
        ),
        z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
          position: z.number(),
          hoist: z.boolean(),
          mentionable: z.boolean(),
          memberCount: z.number(),
          permissions: z.array(z.string()),
        }),
        z.object({
          roleId: z.string(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.roleId, fieldName: "roleId" },
      ]);
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      // Validate role IDs in positions array
      if (ctx.positions != null) {
        for (const pos of ctx.positions) {
          const posError = validateSnowflakes([
            { value: pos.roleId, fieldName: "positions.roleId" },
          ]);
          if (posError != null && posError.length > 0) {
            return { success: false, message: posError };
          }
        }
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list":
          return await handleListRoles(guild);
        case "get":
          return await handleGetRole(guild, ctx.roleId);
        case "create":
          return await handleCreateRole({
            guild,
            name: ctx.name,
            color: ctx.color,
            hoist: ctx.hoist,
            mentionable: ctx.mentionable,
          });
        case "modify":
          return await handleModifyRole({
            guild,
            roleId: ctx.roleId,
            name: ctx.name,
            color: ctx.color,
            hoist: ctx.hoist,
            mentionable: ctx.mentionable,
          });
        case "delete":
          return await handleDeleteRole(guild, ctx.roleId, ctx.reason);
        case "reorder":
          return await handleReorderRoles(guild, ctx.positions);
      }
    } catch (error) {
      const apiError = parseDiscordAPIError(error);
      if (apiError != null) {
        logger.error("Discord API error in manage-role", {
          code: apiError.code,
          status: apiError.status,
          message: apiError.message,
          method: apiError.method,
          url: apiError.url,
          ctx,
        });
        return {
          success: false,
          message: formatDiscordAPIError(apiError),
        };
      }
      logger.error("Failed to manage role", error);
      return {
        success: false,
        message: `Failed: ${getErrorMessage(error)}`,
      };
    }
  },
});

export const roleTools = [manageRoleTool];
