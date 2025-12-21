import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const getMemberTool = createTool({
  id: "get-member",
  description: "Get information about a specific member",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        joinedAt: z.string().nullable(),
        roles: z.array(z.string()),
        isOwner: z.boolean(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      return {
        success: true,
        message: `Found member ${member.user.username}`,
        data: {
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          joinedAt: member.joinedAt?.toISOString() ?? null,
          roles: member.roles.cache.map((r) => r.name),
          isOwner: guild.ownerId === member.id,
        },
      };
    } catch (error) {
      logger.error("Failed to get member", error);
      return {
        success: false,
        message: "Failed to get member information",
      };
    }
  },
});

export const searchMembersTool = createTool({
  id: "search-members",
  description: "Search for members by username",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    query: z.string().describe("Search query (username)"),
    limit: z.number().optional().describe("Maximum number of results (default 10)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          username: z.string(),
          displayName: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const members = await guild.members.search({
        query: context.query,
        limit: context.limit ?? 10,
      });

      const memberList = members.map((member) => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
      }));

      return {
        success: true,
        message: `Found ${String(memberList.length)} members`,
        data: memberList,
      };
    } catch (error) {
      logger.error("Failed to search members", error);
      return {
        success: false,
        message: "Failed to search members",
      };
    }
  },
});

export const modifyMemberTool = createTool({
  id: "modify-member",
  description: "Modify a member's nickname",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    nickname: z.string().nullable().describe("New nickname (null to reset)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      await member.setNickname(context.nickname);

      return {
        success: true,
        message: context.nickname
          ? `Set nickname to "${context.nickname}"`
          : "Reset nickname",
      };
    } catch (error) {
      logger.error("Failed to modify member", error);
      return {
        success: false,
        message: "Failed to modify member",
      };
    }
  },
});

export const addRoleToMemberTool = createTool({
  id: "add-role-to-member",
  description: "Add a role to a member",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    roleId: z.string().describe("The ID of the role to add"),
    reason: z.string().optional().describe("Reason for adding the role"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);
      const role = await guild.roles.fetch(context.roleId);

      if (!role) {
        return {
          success: false,
          message: "Role not found",
        };
      }

      await member.roles.add(role, context.reason);

      return {
        success: true,
        message: `Added role @${role.name} to ${member.user.username}`,
      };
    } catch (error) {
      logger.error("Failed to add role to member", error);
      return {
        success: false,
        message: "Failed to add role to member",
      };
    }
  },
});

export const removeRoleFromMemberTool = createTool({
  id: "remove-role-from-member",
  description: "Remove a role from a member",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    roleId: z.string().describe("The ID of the role to remove"),
    reason: z.string().optional().describe("Reason for removing the role"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);
      const role = await guild.roles.fetch(context.roleId);

      if (!role) {
        return {
          success: false,
          message: "Role not found",
        };
      }

      await member.roles.remove(role, context.reason);

      return {
        success: true,
        message: `Removed role @${role.name} from ${member.user.username}`,
      };
    } catch (error) {
      logger.error("Failed to remove role from member", error);
      return {
        success: false,
        message: "Failed to remove role from member",
      };
    }
  },
});

export const listMembersTool = createTool({
  id: "list-members",
  description: "List members in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    limit: z.number().optional().describe("Maximum number of members to retrieve (default 100)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          username: z.string(),
          displayName: z.string(),
          joinedAt: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const members = await guild.members.fetch({ limit: context.limit ?? 100 });

      const memberList = members.map((member) => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        joinedAt: member.joinedAt?.toISOString() ?? null,
      }));

      return {
        success: true,
        message: `Retrieved ${String(memberList.length)} members`,
        data: memberList,
      };
    } catch (error) {
      logger.error("Failed to list members", error);
      return {
        success: false,
        message: "Failed to list members",
      };
    }
  },
});

export const memberTools = [
  getMemberTool,
  searchMembersTool,
  modifyMemberTool,
  addRoleToMemberTool,
  removeRoleFromMemberTool,
  listMembersTool,
];
