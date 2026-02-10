import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";

export const manageGuildTool = createTool({
  id: "manage-guild",
  description: "Manage Discord guild/server: get info, get owner, modify settings, set icon, set banner, or get audit logs",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["get-info", "get-owner", "modify", "set-icon", "set-banner", "get-audit-logs"]).describe("The action to perform"),
    name: z.string().optional().describe("New server name (for modify)"),
    description: z.string().optional().describe("New server description (for modify)"),
    iconUrl: z.string().optional().describe("URL for new icon (for set-icon)"),
    bannerUrl: z.string().optional().describe("URL for new banner (for set-banner)"),
    limit: z.number().optional().describe("Max entries (for get-audit-logs)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({
        id: z.string(),
        name: z.string(),
        memberCount: z.number(),
        description: z.string().nullable(),
        ownerId: z.string(),
        createdAt: z.string(),
        iconUrl: z.string().nullable(),
        channelCount: z.number(),
        roleCount: z.number(),
      }),
      z.object({
        ownerId: z.string(),
        ownerUsername: z.string(),
        ownerDisplayName: z.string(),
      }),
      z.array(z.object({
        action: z.string(),
        executor: z.string().nullable(),
        target: z.string().nullable(),
        reason: z.string().nullable(),
        createdAt: z.string(),
      })),
    ]).optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
      ]);
      if (idError) {return { success: false, message: idError };}

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "get-info": {
          return {
            success: true,
            message: `Retrieved info for ${guild.name}`,
            data: {
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              description: guild.description,
              ownerId: guild.ownerId,
              createdAt: guild.createdAt.toISOString(),
              iconUrl: guild.iconURL(),
              channelCount: guild.channels.cache.size,
              roleCount: guild.roles.cache.size,
            },
          };
        }

        case "get-owner": {
          const owner = await guild.members.fetch(guild.ownerId);
          return {
            success: true,
            message: `Server owner: ${owner.user.username}`,
            data: {
              ownerId: owner.id,
              ownerUsername: owner.user.username,
              ownerDisplayName: owner.displayName,
            },
          };
        }

        case "modify": {
          const updates: { name?: string; description?: string } = {};
          if (ctx.name) {updates.name = ctx.name;}
          if (ctx.description) {updates.description = ctx.description;}
          if (Object.keys(updates).length === 0) {
            return { success: false, message: "No changes specified" };
          }
          await guild.edit(updates);
          return { success: true, message: "Server updated successfully" };
        }

        case "set-icon": {
          if (!ctx.iconUrl) {return { success: false, message: "iconUrl is required" };}
          await guild.setIcon(ctx.iconUrl);
          return { success: true, message: "Server icon updated successfully" };
        }

        case "set-banner": {
          if (!ctx.bannerUrl) {return { success: false, message: "bannerUrl is required" };}
          await guild.setBanner(ctx.bannerUrl);
          return { success: true, message: "Server banner updated successfully" };
        }

        case "get-audit-logs": {
          const auditLogs = await guild.fetchAuditLogs({ limit: ctx.limit ?? 10 });
          const entries = auditLogs.entries.map((entry) => {
            let targetId: string | null = null;
            if (entry.target && "id" in entry.target && entry.target.id) {
              targetId = entry.target.id;
            }
            return {
              action: String(entry.action),
              executor: entry.executor?.username ?? null,
              target: targetId,
              reason: entry.reason ?? null,
              createdAt: entry.createdAt.toISOString(),
            };
          });
          return {
            success: true,
            message: `Retrieved ${String(entries.length)} audit log entries`,
            data: entries,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage guild", error);
      return { success: false, message: `Failed to manage guild: ${(error as Error).message}` };
    }
  },
});

export const guildTools = [manageGuildTool];
