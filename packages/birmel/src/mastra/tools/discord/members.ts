import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";
import { isDiscordAPIError, formatDiscordAPIError } from "./error-utils.js";

export const manageMemberTool = createTool({
  id: "manage-member",
  description: "Manage Discord members: get, search, list, modify nickname, add role, or remove role",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["get", "search", "list", "modify", "add-role", "remove-role"]).describe("The action to perform"),
    memberId: z.string().optional().describe("Member ID (for get/modify/add-role/remove-role)"),
    query: z.string().optional().describe("Search query (for search)"),
    limit: z.number().optional().describe("Maximum results (for search/list)"),
    nickname: z.string().nullable().optional().describe("New nickname (for modify)"),
    roleId: z.string().optional().describe("Role ID (for add-role/remove-role)"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        joinedAt: z.string().nullable(),
        roles: z.array(z.string()),
        isOwner: z.boolean(),
      }),
      z.array(z.object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        joinedAt: z.string().nullable().optional(),
      })),
    ]).optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.memberId, fieldName: "memberId" },
        { value: ctx.roleId, fieldName: "roleId" },
      ]);
      if (idError) {return { success: false, message: idError };}

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "get": {
          if (!ctx.memberId) {return { success: false, message: "memberId is required for get" };}
          const member = await guild.members.fetch(ctx.memberId);
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
        }

        case "search": {
          if (!ctx.query) {return { success: false, message: "query is required for search" };}
          const members = await guild.members.search({ query: ctx.query, limit: ctx.limit ?? 10 });
          const list = members.map((m) => ({ id: m.id, username: m.user.username, displayName: m.displayName }));
          return { success: true, message: `Found ${String(list.length)} members`, data: list };
        }

        case "list": {
          const members = await guild.members.fetch({ limit: ctx.limit ?? 100 });
          const list = members.map((m) => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            joinedAt: m.joinedAt?.toISOString() ?? null,
          }));
          return { success: true, message: `Retrieved ${String(list.length)} members`, data: list };
        }

        case "modify": {
          if (!ctx.memberId) {return { success: false, message: "memberId is required for modify" };}
          if (ctx.nickname === undefined) {return { success: false, message: "nickname is required for modify" };}
          // Prevent the bot from modifying its own nickname
          if (ctx.memberId === client.user?.id) {
            return { success: false, message: "Cannot modify bot's own nickname. Nickname changes happen via election only." };
          }
          const member = await guild.members.fetch(ctx.memberId);
          await member.setNickname(ctx.nickname);
          return { success: true, message: ctx.nickname ? `Set nickname to "${ctx.nickname}"` : "Reset nickname" };
        }

        case "add-role": {
          if (!ctx.memberId || !ctx.roleId) {return { success: false, message: "memberId and roleId are required for add-role" };}
          const member = await guild.members.fetch(ctx.memberId);
          const role = await guild.roles.fetch(ctx.roleId);
          if (!role) {return { success: false, message: "Role not found" };}
          await member.roles.add(role, ctx.reason);
          return { success: true, message: `Added role @${role.name} to ${member.user.username}` };
        }

        case "remove-role": {
          if (!ctx.memberId || !ctx.roleId) {return { success: false, message: "memberId and roleId are required for remove-role" };}
          const member = await guild.members.fetch(ctx.memberId);
          const role = await guild.roles.fetch(ctx.roleId);
          if (!role) {return { success: false, message: "Role not found" };}
          await member.roles.remove(role, ctx.reason);
          return { success: true, message: `Removed role @${role.name} from ${member.user.username}` };
        }
      }
    } catch (error) {
      if (isDiscordAPIError(error)) {
        logger.error("Discord API error in manage-member", {
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
      logger.error("Failed to manage member", error);
      return { success: false, message: `Failed: ${(error as Error).message}` };
    }
  },
});

export const memberTools = [manageMemberTool];
