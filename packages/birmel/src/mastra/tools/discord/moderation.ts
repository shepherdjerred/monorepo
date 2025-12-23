import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const kickMemberTool = createTool({
  id: "kick-member",
  description: "Kick a member from the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to kick"),
    reason: z.string().optional().describe("Reason for kicking the member"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const member = await guild.members.fetch(ctx.context.memberId);

      await member.kick(ctx.context.reason);

      return {
        success: true,
        message: `Kicked ${member.user.username}`,
      };
    } catch (error) {
      logger.error("Failed to kick member", error);
      return {
        success: false,
        message: "Failed to kick member",
      };
    }
  },
});

export const banMemberTool = createTool({
  id: "ban-member",
  description: "Ban a member from the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to ban"),
    reason: z.string().optional().describe("Reason for banning the member"),
    deleteMessageSeconds: z
      .number()
      .optional()
      .describe("Number of seconds of messages to delete (0-604800)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);

      const banOptions: { reason?: string; deleteMessageSeconds?: number } = {};
      if (ctx.context.reason !== undefined) banOptions.reason = ctx.context.reason;
      if (ctx.context.deleteMessageSeconds !== undefined)
        banOptions.deleteMessageSeconds = ctx.context.deleteMessageSeconds;

      await guild.members.ban(ctx.context.memberId, banOptions);

      return {
        success: true,
        message: `Banned user ${ctx.context.memberId}`,
      };
    } catch (error) {
      logger.error("Failed to ban member", error);
      return {
        success: false,
        message: "Failed to ban member",
      };
    }
  },
});

export const unbanMemberTool = createTool({
  id: "unban-member",
  description: "Unban a user from the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    userId: z.string().describe("The ID of the user to unban"),
    reason: z.string().optional().describe("Reason for unbanning the user"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);

      await guild.members.unban(ctx.context.userId, ctx.context.reason);

      return {
        success: true,
        message: `Unbanned user ${ctx.context.userId}`,
      };
    } catch (error) {
      logger.error("Failed to unban user", error);
      return {
        success: false,
        message: "Failed to unban user",
      };
    }
  },
});

export const timeoutMemberTool = createTool({
  id: "timeout-member",
  description: "Timeout (mute) a member for a specified duration",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to timeout"),
    durationMinutes: z
      .number()
      .min(1)
      .max(40320)
      .describe("Duration of timeout in minutes (max 28 days)"),
    reason: z.string().optional().describe("Reason for the timeout"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const member = await guild.members.fetch(ctx.context.memberId);

      const durationMs = ctx.context.durationMinutes * 60 * 1000;
      await member.timeout(durationMs, ctx.context.reason);

      return {
        success: true,
        message: `Timed out ${member.user.username} for ${String(ctx.context.durationMinutes)} minutes`,
      };
    } catch (error) {
      logger.error("Failed to timeout member", error);
      return {
        success: false,
        message: "Failed to timeout member",
      };
    }
  },
});

export const removeTimeoutTool = createTool({
  id: "remove-timeout",
  description: "Remove timeout from a member",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to remove timeout from"),
    reason: z.string().optional().describe("Reason for removing the timeout"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const member = await guild.members.fetch(ctx.context.memberId);

      await member.timeout(null, ctx.context.reason);

      return {
        success: true,
        message: `Removed timeout from ${member.user.username}`,
      };
    } catch (error) {
      logger.error("Failed to remove timeout", error);
      return {
        success: false,
        message: "Failed to remove timeout",
      };
    }
  },
});

export const listBansTool = createTool({
  id: "list-bans",
  description: "List all banned users in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    limit: z.number().optional().describe("Maximum number of bans to retrieve (default 100)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          username: z.string(),
          reason: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const bans = await guild.bans.fetch({ limit: ctx.context.limit ?? 100 });

      const banList = bans.map((ban) => ({
        id: ban.user.id,
        username: ban.user.username,
        reason: ban.reason ?? null,
      }));

      return {
        success: true,
        message: `Found ${String(banList.length)} banned users`,
        data: banList,
      };
    } catch (error) {
      logger.error("Failed to list bans", error);
      return {
        success: false,
        message: "Failed to list bans",
      };
    }
  },
});

export const moderationTools = [
  kickMemberTool,
  banMemberTool,
  unbanMemberTool,
  timeoutMemberTool,
  removeTimeoutTool,
  listBansTool,
];
