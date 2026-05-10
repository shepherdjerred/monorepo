import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSnowflakes } from "./validation.ts";
import { parseDiscordAPIError, formatDiscordAPIError } from "./error-utils.ts";
import {
  handleGetMember,
  handleSearchMembers,
  handleListMembers,
  handleModifyMember,
  handleAddRole,
  handleRemoveRole,
} from "./member-actions.ts";

export const manageMemberTool = createTool({
  id: "manage-member",
  description:
    "Manage Discord members: get, search, list, modify nickname, add role, or remove role",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["get", "search", "list", "modify", "add-role", "remove-role"])
      .describe("The action to perform"),
    memberId: z
      .string()
      .optional()
      .describe("Member ID (for get/modify/add-role/remove-role)"),
    query: z.string().optional().describe("Search query (for search)"),
    limit: z.number().optional().describe("Maximum results (for search/list)"),
    nickname: z
      .string()
      .nullable()
      .optional()
      .describe("New nickname (for modify)"),
    roleId: z
      .string()
      .optional()
      .describe("Role ID (for add-role/remove-role)"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          id: z.string(),
          username: z.string(),
          displayName: z.string(),
          joinedAt: z.string().nullable(),
          roles: z.array(z.string()),
          isOwner: z.boolean(),
        }),
        z.array(
          z.object({
            id: z.string(),
            username: z.string(),
            displayName: z.string(),
            joinedAt: z.string().nullable().optional(),
          }),
        ),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.memberId, fieldName: "memberId" },
        { value: ctx.roleId, fieldName: "roleId" },
      ]);
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "get":
          return await handleGetMember(guild, ctx.memberId);
        case "search":
          return await handleSearchMembers(guild, ctx.query, ctx.limit);
        case "list":
          return await handleListMembers(guild, ctx.limit);
        case "modify":
          return await handleModifyMember(
            client,
            guild,
            ctx.memberId,
            ctx.nickname,
          );
        case "add-role":
          return await handleAddRole(
            guild,
            ctx.memberId,
            ctx.roleId,
            ctx.reason,
          );
        case "remove-role":
          return await handleRemoveRole(
            guild,
            ctx.memberId,
            ctx.roleId,
            ctx.reason,
          );
      }
    } catch (error) {
      const apiError = parseDiscordAPIError(error);
      if (apiError != null) {
        logger.error("Discord API error in manage-member", {
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
      logger.error("Failed to manage member", error);
      return { success: false, message: `Failed: ${getErrorMessage(error)}` };
    }
  },
});

export const memberTools = [manageMemberTool];
