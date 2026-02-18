import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";
import { isDiscordAPIError, formatDiscordAPIError } from "./error-utils.js";
import {
  handleListRoles,
  handleGetRole,
  handleCreateRole,
  handleModifyRole,
  handleDeleteRole,
  handleReorderRoles,
} from "./role-actions.js";

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
          return await handleCreateRole(
            guild,
            ctx.name,
            ctx.color,
            ctx.hoist,
            ctx.mentionable,
          );
        case "modify":
          return await handleModifyRole(
            guild,
            ctx.roleId,
            ctx.name,
            ctx.color,
            ctx.hoist,
            ctx.mentionable,
          );
        case "delete":
          return await handleDeleteRole(guild, ctx.roleId, ctx.reason);
        case "reorder":
          return await handleReorderRoles(guild, ctx.positions);
      }
    } catch (error) {
      if (isDiscordAPIError(error)) {
        logger.error("Discord API error in manage-role", {
          code: error.code,
          status: error.status,
          message: error.message,
          method: error.method,
          url: error.url,
          ctx,
        });
        return {
          success: false,
          message: formatDiscordAPIError(error),
        };
      }
      logger.error("Failed to manage role", error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  },
});

export const roleTools = [manageRoleTool];
