import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const getGuildInfoTool = createTool({
  id: "get-guild-info",
  description: "Get information about the current Discord server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild to get info for"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        memberCount: z.number(),
        description: z.string().nullable(),
        ownerId: z.string(),
        createdAt: z.string(),
        iconUrl: z.string().nullable(),
        channelCount: z.number(),
        roleCount: z.number(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

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
    } catch (error) {
      logger.error("Failed to get guild info", error);
      return {
        success: false,
        message: "Failed to retrieve server information",
      };
    }
  },
});

export const modifyGuildTool = createTool({
  id: "modify-guild",
  description: "Modify server settings like name or description",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild to modify"),
    name: z.string().optional().describe("New name for the server"),
    description: z
      .string()
      .optional()
      .describe("New description for the server"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      const updates: { name?: string; description?: string } = {};
      if (ctx.name) updates.name = ctx.name;
      if (ctx.description) updates.description = ctx.description;

      if (Object.keys(updates).length === 0) {
        return {
          success: false,
          message: "No changes specified",
        };
      }

      await guild.edit(updates);

      return {
        success: true,
        message: `Server updated successfully`,
      };
    } catch (error) {
      logger.error("Failed to modify guild", error);
      return {
        success: false,
        message: "Failed to modify server settings",
      };
    }
  },
});

export const setGuildIconTool = createTool({
  id: "set-guild-icon",
  description: "Set the server icon",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    iconUrl: z.string().describe("URL of the new icon image"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      await guild.setIcon(ctx.iconUrl);
      return {
        success: true,
        message: "Server icon updated successfully",
      };
    } catch (error) {
      logger.error("Failed to set guild icon", error);
      return {
        success: false,
        message: "Failed to set server icon",
      };
    }
  },
});

export const setGuildBannerTool = createTool({
  id: "set-guild-banner",
  description: "Set the server banner (requires server boost level 2+)",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    bannerUrl: z.string().describe("URL of the new banner image"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      await guild.setBanner(ctx.bannerUrl);
      return {
        success: true,
        message: "Server banner updated successfully",
      };
    } catch (error) {
      logger.error("Failed to set guild banner", error);
      return {
        success: false,
        message: "Failed to set server banner. Make sure the server has boost level 2 or higher.",
      };
    }
  },
});

export const getAuditLogsTool = createTool({
  id: "get-audit-logs",
  description: "Get recent audit log entries for the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    limit: z.number().optional().describe("Maximum number of entries to retrieve (default 10)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          action: z.string(),
          executor: z.string().nullable(),
          target: z.string().nullable(),
          reason: z.string().nullable(),
          createdAt: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
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
    } catch (error) {
      logger.error("Failed to get audit logs", error);
      return {
        success: false,
        message: "Failed to retrieve audit logs",
      };
    }
  },
});

export const getGuildPruneCountTool = createTool({
  id: "get-guild-prune-count",
  description: "Get the number of members that would be pruned",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    days: z.number().describe("Number of days of inactivity (1-30)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        count: z.number(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const pruneCount = await guild.members.prune({ days: ctx.days, dry: true });

      return {
        success: true,
        message: `${String(pruneCount)} members would be pruned`,
        data: {
          count: pruneCount,
        },
      };
    } catch (error) {
      logger.error("Failed to get prune count", error);
      return {
        success: false,
        message: "Failed to get prune count",
      };
    }
  },
});

export const pruneMembersTool = createTool({
  id: "prune-members",
  description: "Remove inactive members from the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    days: z.number().describe("Number of days of inactivity (1-30)"),
    reason: z.string().optional().describe("Reason for pruning"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        pruned: z.number(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const pruneOptions: Parameters<typeof guild.members.prune>[0] = {
        days: ctx.days,
      };
      if (ctx.reason !== undefined) pruneOptions.reason = ctx.reason;
      const pruned = await guild.members.prune(pruneOptions);

      return {
        success: true,
        message: `Pruned ${String(pruned)} inactive members`,
        data: {
          pruned,
        },
      };
    } catch (error) {
      logger.error("Failed to prune members", error);
      return {
        success: false,
        message: "Failed to prune members",
      };
    }
  },
});

export const guildTools = [
  getGuildInfoTool,
  modifyGuildTool,
  setGuildIconTool,
  setGuildBannerTool,
  getAuditLogsTool,
  getGuildPruneCountTool,
  pruneMembersTool,
];
