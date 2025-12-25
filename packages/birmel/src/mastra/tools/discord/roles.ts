import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ColorResolvable } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";

export const manageRoleTool = createTool({
  id: "manage-role",
  description: "Manage roles in the server: list all, get details, create, modify, delete, or reorder",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["list", "get", "create", "modify", "delete", "reorder"]).describe("The action to perform"),
    roleId: z.string().optional().describe("The ID of the role (required for get/modify/delete)"),
    name: z.string().optional().describe("Name of the role (required for create, optional for modify)"),
    color: z.string().optional().describe("Hex color code (e.g., #FF0000)"),
    hoist: z.boolean().optional().describe("Whether to display separately in member list"),
    mentionable: z.boolean().optional().describe("Whether the role can be mentioned"),
    positions: z
      .array(
        z.object({
          roleId: z.string(),
          position: z.number(),
        }),
      )
      .optional()
      .describe("Array of role IDs and their new positions (required for reorder)"),
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
      if (idError) return { success: false, message: idError };

      // Validate role IDs in positions array
      if (ctx.positions) {
        for (const pos of ctx.positions) {
          const posError = validateSnowflakes([{ value: pos.roleId, fieldName: "positions.roleId" }]);
          if (posError) return { success: false, message: posError };
        }
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list": {
          const roles = await guild.roles.fetch();
          const roleList = roles
            .map((role) => ({
              id: role.id,
              name: role.name,
              color: role.hexColor,
              position: role.position,
              memberCount: role.members.size,
            }))
            .sort((a, b) => b.position - a.position);
          return {
            success: true,
            message: `Found ${String(roleList.length)} roles`,
            data: roleList,
          };
        }

        case "get": {
          if (!ctx.roleId) {
            return {
              success: false,
              message: "roleId is required for getting role details",
            };
          }
          const role = await guild.roles.fetch(ctx.roleId);
          if (!role) {
            return {
              success: false,
              message: "Role not found",
            };
          }
          return {
            success: true,
            message: `Found role @${role.name}`,
            data: {
              id: role.id,
              name: role.name,
              color: role.hexColor,
              position: role.position,
              hoist: role.hoist,
              mentionable: role.mentionable,
              memberCount: role.members.size,
              permissions: role.permissions.toArray(),
            },
          };
        }

        case "create": {
          if (!ctx.name) {
            return {
              success: false,
              message: "name is required for creating a role",
            };
          }
          const role = await guild.roles.create({
            name: ctx.name,
            ...(ctx.color !== undefined && { color: ctx.color as ColorResolvable }),
            ...(ctx.hoist !== undefined && { hoist: ctx.hoist }),
            ...(ctx.mentionable !== undefined && { mentionable: ctx.mentionable }),
          });
          return {
            success: true,
            message: `Created role @${role.name}`,
            data: { roleId: role.id },
          };
        }

        case "modify": {
          if (!ctx.roleId) {
            return {
              success: false,
              message: "roleId is required for modifying a role",
            };
          }
          const role = await guild.roles.fetch(ctx.roleId);
          if (!role) {
            return {
              success: false,
              message: "Role not found",
            };
          }
          const hasChanges =
            ctx.name !== undefined ||
            ctx.color !== undefined ||
            ctx.hoist !== undefined ||
            ctx.mentionable !== undefined;
          if (!hasChanges) {
            return {
              success: false,
              message: "No changes specified",
            };
          }
          await role.edit({
            ...(ctx.name !== undefined && { name: ctx.name }),
            ...(ctx.color !== undefined && { color: ctx.color as ColorResolvable }),
            ...(ctx.hoist !== undefined && { hoist: ctx.hoist }),
            ...(ctx.mentionable !== undefined && { mentionable: ctx.mentionable }),
          });
          return {
            success: true,
            message: `Updated role @${role.name}`,
          };
        }

        case "delete": {
          if (!ctx.roleId) {
            return {
              success: false,
              message: "roleId is required for deleting a role",
            };
          }
          const role = await guild.roles.fetch(ctx.roleId);
          if (!role) {
            return {
              success: false,
              message: "Role not found",
            };
          }
          const roleName = role.name;
          await role.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted role @${roleName}`,
          };
        }

        case "reorder": {
          if (!ctx.positions || ctx.positions.length === 0) {
            return {
              success: false,
              message: "positions array is required for reordering roles",
            };
          }
          await guild.roles.setPositions(
            ctx.positions.map((p: { roleId: string; position: number }) => ({
              role: p.roleId,
              position: p.position,
            })),
          );
          return {
            success: true,
            message: `Reordered ${String(ctx.positions.length)} roles`,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage role", error);
      return {
        success: false,
        message: `Failed to manage role: ${(error as Error).message}`,
      };
    }
  },
});

export const roleTools = [manageRoleTool];
