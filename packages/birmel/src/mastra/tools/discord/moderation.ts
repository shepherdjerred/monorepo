import type { Guild } from "discord.js";
import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";
import { isDiscordAPIError, formatDiscordAPIError } from "./error-utils.js";

type ModerationResult = {
  success: boolean;
  message: string;
  data?:
    | { id: string; username: string; reason: string | null }[]
    | { pruneCount: number };
};

async function handleKick(
  guild: Guild,
  memberId: string | undefined,
  reason: string | undefined,
): Promise<ModerationResult> {
  if (memberId == null || memberId.length === 0) {
    return { success: false, message: "memberId is required for kick" };
  }
  const member = await guild.members.fetch(memberId);
  await member.kick(reason);
  return { success: true, message: `Kicked ${member.user.username}` };
}

async function handleBan(
  guild: Guild,
  memberId: string | undefined,
  reason: string | undefined,
  deleteMessageSeconds: number | undefined,
): Promise<ModerationResult> {
  if (memberId == null || memberId.length === 0) {
    return { success: false, message: "memberId is required for ban" };
  }
  const banOpts: { reason?: string; deleteMessageSeconds?: number } = {};
  if (reason !== undefined) {
    banOpts.reason = reason;
  }
  if (deleteMessageSeconds !== undefined) {
    banOpts.deleteMessageSeconds = deleteMessageSeconds;
  }
  await guild.members.ban(memberId, banOpts);
  return { success: true, message: `Banned user ${memberId}` };
}

async function handlePrune(
  guild: Guild,
  days: number | undefined,
  reason: string | undefined,
  dryRun: boolean,
): Promise<ModerationResult> {
  if (days == null) {
    return {
      success: false,
      message: `days is required for ${dryRun ? "prune-count" : "prune"}`,
    };
  }
  if (dryRun) {
    const count = await guild.members.prune({ days, dry: true });
    return {
      success: true,
      message: `${String(count)} members would be pruned`,
      data: { pruneCount: count },
    };
  }
  const pruneOpts: { days: number; reason?: string } = { days };
  if (reason != null && reason.length > 0) {
    pruneOpts.reason = reason;
  }
  const pruned = await guild.members.prune(pruneOpts);
  return {
    success: true,
    message: `Pruned ${String(pruned)} members`,
    data: { pruneCount: pruned },
  };
}

export const moderateMemberTool = createTool({
  id: "moderate-member",
  description:
    "Moderate Discord members: kick, ban, unban, timeout, remove timeout, list bans, or prune inactive",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum([
        "kick",
        "ban",
        "unban",
        "timeout",
        "remove-timeout",
        "list-bans",
        "prune",
        "prune-count",
      ])
      .describe("The action to perform"),
    memberId: z
      .string()
      .optional()
      .describe("Member/user ID (for kick/ban/unban/timeout/remove-timeout)"),
    reason: z.string().optional().describe("Reason for the action"),
    deleteMessageSeconds: z
      .number()
      .optional()
      .describe("Seconds of messages to delete (for ban, 0-604800)"),
    durationMinutes: z
      .number()
      .min(1)
      .max(40_320)
      .optional()
      .describe("Timeout duration in minutes (for timeout)"),
    limit: z.number().optional().describe("Maximum results (for list-bans)"),
    days: z
      .number()
      .min(1)
      .max(30)
      .optional()
      .describe("Days of inactivity (for prune/prune-count)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            id: z.string(),
            username: z.string(),
            reason: z.string().nullable(),
          }),
        ),
        z.object({ pruneCount: z.number() }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.memberId, fieldName: "memberId" },
      ]);
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "kick":
          return await handleKick(guild, ctx.memberId, ctx.reason);
        case "ban":
          return await handleBan(
            guild,
            ctx.memberId,
            ctx.reason,
            ctx.deleteMessageSeconds,
          );
        case "unban": {
          if (ctx.memberId == null || ctx.memberId.length === 0) {
            return {
              success: false,
              message: "memberId is required for unban",
            };
          }
          await guild.members.unban(ctx.memberId, ctx.reason);
          return { success: true, message: `Unbanned user ${ctx.memberId}` };
        }
        case "timeout": {
          if (
            ctx.memberId == null ||
            ctx.memberId.length === 0 ||
            ctx.durationMinutes == null
          ) {
            return {
              success: false,
              message: "memberId and durationMinutes are required for timeout",
            };
          }
          const member = await guild.members.fetch(ctx.memberId);
          await member.timeout(ctx.durationMinutes * 60 * 1000, ctx.reason);
          return {
            success: true,
            message: `Timed out ${member.user.username} for ${String(ctx.durationMinutes)} minutes`,
          };
        }
        case "remove-timeout": {
          if (ctx.memberId == null || ctx.memberId.length === 0) {
            return {
              success: false,
              message: "memberId is required for remove-timeout",
            };
          }
          const member = await guild.members.fetch(ctx.memberId);
          await member.timeout(null, ctx.reason);
          return {
            success: true,
            message: `Removed timeout from ${member.user.username}`,
          };
        }
        case "list-bans": {
          const bans = await guild.bans.fetch({ limit: ctx.limit ?? 100 });
          const list = bans.map((b) => ({
            id: b.user.id,
            username: b.user.username,
            reason: b.reason ?? null,
          }));
          return {
            success: true,
            message: `Found ${String(list.length)} banned users`,
            data: list,
          };
        }
        case "prune":
          return await handlePrune(guild, ctx.days, ctx.reason, false);
        case "prune-count":
          return await handlePrune(guild, ctx.days, ctx.reason, true);
      }
    } catch (error) {
      if (isDiscordAPIError(error)) {
        logger.error("Discord API error in moderate-member", {
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
      logger.error("Failed to moderate member", error);
      return { success: false, message: `Failed: ${(error as Error).message}` };
    }
  },
});

export const moderationTools = [moderateMemberTool];
