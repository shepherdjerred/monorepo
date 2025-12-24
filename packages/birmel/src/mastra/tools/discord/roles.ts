import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ColorResolvable } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const listRolesTool = createTool({
  id: "list-roles",
  description: "List all roles in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
          position: z.number(),
          memberCount: z.number(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
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
    } catch (error) {
      logger.error("Failed to list roles", error);
      return {
        success: false,
        message: "Failed to list roles",
      };
    }
  },
});

export const createRoleTool = createTool({
  id: "create-role",
  description: "Create a new role in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name of the role"),
    color: z.string().optional().describe("Hex color code (e.g., #FF0000)"),
    hoist: z.boolean().optional().describe("Whether to display separately in member list"),
    mentionable: z.boolean().optional().describe("Whether the role can be mentioned"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        roleId: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      const role = await guild.roles.create({
        name: ctx.name,
        ...(ctx.color !== undefined && { color: ctx.color as ColorResolvable }),
        ...(ctx.hoist !== undefined && { hoist: ctx.hoist }),
        ...(ctx.mentionable !== undefined && { mentionable: ctx.mentionable }),
      });

      return {
        success: true,
        message: `Created role @${role.name}`,
        data: {
          roleId: role.id,
        },
      };
    } catch (error) {
      logger.error("Failed to create role", error);
      return {
        success: false,
        message: "Failed to create role",
      };
    }
  },
});

export const deleteRoleTool = createTool({
  id: "delete-role",
  description: "Delete a role from the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    roleId: z.string().describe("The ID of the role to delete"),
    reason: z.string().optional().describe("Reason for deleting the role"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
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
    } catch (error) {
      logger.error("Failed to delete role", error);
      return {
        success: false,
        message: "Failed to delete role",
      };
    }
  },
});

export const modifyRoleTool = createTool({
  id: "modify-role",
  description: "Modify an existing role's settings",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    roleId: z.string().describe("The ID of the role to modify"),
    name: z.string().optional().describe("New name for the role"),
    color: z.string().optional().describe("New hex color code"),
    hoist: z.boolean().optional().describe("Whether to display separately"),
    mentionable: z.boolean().optional().describe("Whether the role can be mentioned"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
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
    } catch (error) {
      logger.error("Failed to modify role", error);
      return {
        success: false,
        message: "Failed to modify role",
      };
    }
  },
});

export const getRoleTool = createTool({
  id: "get-role",
  description: "Get detailed information about a specific role",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    roleId: z.string().describe("The ID of the role"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        position: z.number(),
        hoist: z.boolean(),
        mentionable: z.boolean(),
        memberCount: z.number(),
        permissions: z.array(z.string()),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
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
    } catch (error) {
      logger.error("Failed to get role", error);
      return {
        success: false,
        message: "Failed to get role",
      };
    }
  },
});

export const reorderRolesTool = createTool({
  id: "reorder-roles",
  description: "Reorder roles in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    positions: z
      .array(
        z.object({
          roleId: z.string(),
          position: z.number(),
        }),
      )
      .describe("Array of role IDs and their new positions"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

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
    } catch (error) {
      logger.error("Failed to reorder roles", error);
      return {
        success: false,
        message: "Failed to reorder roles",
      };
    }
  },
});

export const roleTools = [
  listRolesTool,
  getRoleTool,
  createRoleTool,
  deleteRoleTool,
  modifyRoleTool,
  reorderRolesTool,
];
