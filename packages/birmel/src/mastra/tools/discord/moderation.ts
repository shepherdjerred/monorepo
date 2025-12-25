import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const moderateMemberTool = createTool({
  id: "moderate-member",
  description: "Moderate Discord members: kick, ban, unban, timeout, remove timeout, list bans, or prune inactive",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["kick", "ban", "unban", "timeout", "remove-timeout", "list-bans", "prune", "prune-count"]).describe("The action to perform"),
    memberId: z.string().optional().describe("Member/user ID (for kick/ban/unban/timeout/remove-timeout)"),
    reason: z.string().optional().describe("Reason for the action"),
    deleteMessageSeconds: z.number().optional().describe("Seconds of messages to delete (for ban, 0-604800)"),
    durationMinutes: z.number().min(1).max(40320).optional().describe("Timeout duration in minutes (for timeout)"),
    limit: z.number().optional().describe("Maximum results (for list-bans)"),
    days: z.number().min(1).max(30).optional().describe("Days of inactivity (for prune/prune-count)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.array(z.object({ id: z.string(), username: z.string(), reason: z.string().nullable() })),
      z.object({ pruneCount: z.number() }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "kick": {
          if (!ctx.memberId) return { success: false, message: "memberId is required for kick" };
          const member = await guild.members.fetch(ctx.memberId);
          await member.kick(ctx.reason);
          return { success: true, message: `Kicked ${member.user.username}` };
        }

        case "ban": {
          if (!ctx.memberId) return { success: false, message: "memberId is required for ban" };
          const banOpts: { reason?: string; deleteMessageSeconds?: number } = {};
          if (ctx.reason !== undefined) banOpts.reason = ctx.reason;
          if (ctx.deleteMessageSeconds !== undefined) banOpts.deleteMessageSeconds = ctx.deleteMessageSeconds;
          await guild.members.ban(ctx.memberId, banOpts);
          return { success: true, message: `Banned user ${ctx.memberId}` };
        }

        case "unban": {
          if (!ctx.memberId) return { success: false, message: "memberId is required for unban" };
          await guild.members.unban(ctx.memberId, ctx.reason);
          return { success: true, message: `Unbanned user ${ctx.memberId}` };
        }

        case "timeout": {
          if (!ctx.memberId || !ctx.durationMinutes) return { success: false, message: "memberId and durationMinutes are required for timeout" };
          const member = await guild.members.fetch(ctx.memberId);
          await member.timeout(ctx.durationMinutes * 60 * 1000, ctx.reason);
          return { success: true, message: `Timed out ${member.user.username} for ${String(ctx.durationMinutes)} minutes` };
        }

        case "remove-timeout": {
          if (!ctx.memberId) return { success: false, message: "memberId is required for remove-timeout" };
          const member = await guild.members.fetch(ctx.memberId);
          await member.timeout(null, ctx.reason);
          return { success: true, message: `Removed timeout from ${member.user.username}` };
        }

        case "list-bans": {
          const bans = await guild.bans.fetch({ limit: ctx.limit ?? 100 });
          const list = bans.map((b) => ({ id: b.user.id, username: b.user.username, reason: b.reason ?? null }));
          return { success: true, message: `Found ${String(list.length)} banned users`, data: list };
        }

        case "prune": {
          if (!ctx.days) return { success: false, message: "days is required for prune" };
          const pruneOpts: { days: number; reason?: string } = { days: ctx.days };
          if (ctx.reason) pruneOpts.reason = ctx.reason;
          const pruned = await guild.members.prune(pruneOpts);
          return { success: true, message: `Pruned ${String(pruned)} members`, data: { pruneCount: pruned } };
        }

        case "prune-count": {
          if (!ctx.days) return { success: false, message: "days is required for prune-count" };
          const count = await guild.members.prune({ days: ctx.days, dry: true });
          return { success: true, message: `${String(count)} members would be pruned`, data: { pruneCount: count } };
        }
      }
    } catch (error) {
      logger.error("Failed to moderate member", error);
      return { success: false, message: "Failed to moderate member" };
    }
  },
});

export const moderationTools = [moderateMemberTool];
