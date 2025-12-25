import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ChannelType, PermissionFlagsBits, type GuildChannelEditOptions } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";

const logger = loggers.tools.child("discord.channels");

const normalizePermissionName = (perm: string): string => {
  if (perm in PermissionFlagsBits) return perm;
  const pascalCase = perm.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  if (pascalCase in PermissionFlagsBits) return pascalCase;
  logger.warn(`Unknown permission name: ${perm}`);
  return perm;
};

export const manageChannelTool = createTool({
  id: "manage-channel",
  description: "Manage Discord channels: list, get, create, modify, delete, reorder, or set permissions",
  inputSchema: z.object({
    action: z.enum(["list", "get", "create", "modify", "delete", "reorder", "set-permissions"]).describe("The action to perform"),
    guildId: z.string().optional().describe("Guild ID (for list/create/reorder)"),
    channelId: z.string().optional().describe("Channel ID (for get/modify/delete/set-permissions)"),
    name: z.string().optional().describe("Channel name (for create/modify)"),
    type: z.enum(["text", "voice", "category"]).optional().describe("Channel type (for create)"),
    parentId: z.string().nullable().optional().describe("Parent category ID"),
    topic: z.string().optional().describe("Channel topic"),
    position: z.number().optional().describe("Channel position"),
    positions: z.array(z.object({ channelId: z.string(), position: z.number() })).optional().describe("Positions array (for reorder)"),
    targetId: z.string().optional().describe("Role/user ID (for set-permissions)"),
    targetType: z.enum(["role", "member"]).optional().describe("Target type (for set-permissions)"),
    allow: z.array(z.string()).optional().describe("Permissions to allow"),
    deny: z.array(z.string()).optional().describe("Permissions to deny"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), parentId: z.string().nullable() })),
      z.object({ id: z.string(), name: z.string(), type: z.string(), topic: z.string().nullable(), parentId: z.string().nullable(), position: z.number() }),
      z.object({ channelId: z.string() }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-channel", ctx.guildId, async () => {
      try {
        const client = getDiscordClient();

        switch (ctx.action) {
          case "list": {
            if (!ctx.guildId) return { success: false, message: "guildId is required for list" };
            const guild = await client.guilds.fetch(ctx.guildId);
            const channels = await guild.channels.fetch();
            const list = channels.map((ch) => ({
              id: ch?.id ?? "",
              name: ch?.name ?? "",
              type: ch?.type !== undefined ? ChannelType[ch.type] : "Unknown",
              parentId: ch?.parentId ?? null,
            }));
            return { success: true, message: `Found ${String(list.length)} channels`, data: list };
          }

          case "get": {
            if (!ctx.channelId) return { success: false, message: "channelId is required for get" };
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel) return { success: false, message: "Channel not found" };
            return {
              success: true,
              message: "Retrieved channel information",
              data: {
                id: channel.id,
                name: "name" in channel ? (channel.name ?? "Unknown") : "Unknown",
                type: ChannelType[channel.type],
                topic: "topic" in channel ? channel.topic : null,
                parentId: "parentId" in channel ? channel.parentId : null,
                position: "position" in channel ? channel.position : 0,
              },
            };
          }

          case "create": {
            if (!ctx.guildId || !ctx.name || !ctx.type) return { success: false, message: "guildId, name, and type are required for create" };
            const guild = await client.guilds.fetch(ctx.guildId);
            const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory } as const;
            const channel = await guild.channels.create({
              name: ctx.name,
              type: typeMap[ctx.type],
              ...(ctx.parentId !== undefined && { parent: ctx.parentId }),
              ...(ctx.topic !== undefined && { topic: ctx.topic }),
            });
            return { success: true, message: `Created channel #${channel.name}`, data: { channelId: channel.id } };
          }

          case "modify": {
            if (!ctx.channelId) return { success: false, message: "channelId is required for modify" };
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel || !("edit" in channel)) return { success: false, message: "Channel not found or cannot be edited" };
            const opts: GuildChannelEditOptions = {};
            if (ctx.name !== undefined) opts.name = ctx.name;
            if (ctx.topic !== undefined) opts.topic = ctx.topic;
            if (ctx.position !== undefined) opts.position = ctx.position;
            if (ctx.parentId !== undefined) opts.parent = ctx.parentId;
            await channel.edit(opts as Parameters<typeof channel.edit>[0]);
            return { success: true, message: "Channel updated successfully" };
          }

          case "delete": {
            if (!ctx.channelId) return { success: false, message: "channelId is required for delete" };
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel || !("delete" in channel)) return { success: false, message: "Channel not found or cannot be deleted" };
            await channel.delete(ctx.reason);
            return { success: true, message: "Channel deleted successfully" };
          }

          case "reorder": {
            if (!ctx.guildId || !ctx.positions?.length) return { success: false, message: "guildId and positions are required for reorder" };
            const guild = await client.guilds.fetch(ctx.guildId);
            await guild.channels.setPositions(ctx.positions.map((p) => ({ channel: p.channelId, position: p.position })));
            return { success: true, message: `Reordered ${String(ctx.positions.length)} channels` };
          }

          case "set-permissions": {
            if (!ctx.channelId || !ctx.targetId) return { success: false, message: "channelId and targetId are required for set-permissions" };
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel || !("permissionOverwrites" in channel)) return { success: false, message: "Channel not found or does not support permissions" };
            await channel.permissionOverwrites.edit(ctx.targetId, {
              ...(ctx.allow?.reduce((acc: Record<string, boolean>, perm: string) => ({ ...acc, [normalizePermissionName(perm)]: true }), {}) ?? {}),
              ...(ctx.deny?.reduce((acc: Record<string, boolean>, perm: string) => ({ ...acc, [normalizePermissionName(perm)]: false }), {}) ?? {}),
            });
            return { success: true, message: "Channel permissions updated successfully" };
          }
        }
      } catch (error) {
        logger.error("Failed to manage channel", error);
        captureException(error as Error, { operation: "tool.manage-channel" });
        return { success: false, message: `Failed: ${(error as Error).message}` };
      }
    });
  },
});

export const channelTools = [manageChannelTool];
