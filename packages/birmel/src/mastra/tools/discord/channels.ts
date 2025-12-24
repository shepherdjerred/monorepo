import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ChannelType, PermissionFlagsBits, type GuildChannelEditOptions } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";

const logger = loggers.tools.child("discord.channels");

// Map from various permission name formats to Discord.js v14 PermissionFlagsBits keys
const normalizePermissionName = (perm: string): string => {
  // If it's already in the correct format (camelCase), return as-is
  if (perm in PermissionFlagsBits) {
    return perm;
  }

  // Convert SCREAMING_SNAKE_CASE to PascalCase (which discord.js uses)
  // e.g., VIEW_CHANNEL -> ViewChannel, SEND_MESSAGES -> SendMessages
  const pascalCase = perm
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  if (pascalCase in PermissionFlagsBits) {
    return pascalCase;
  }

  // Return original if no mapping found - will cause an error but with better context
  logger.warn(`Unknown permission name: ${perm}, tried: ${pascalCase}`);
  return perm;
};

export const listChannelsTool = createTool({
  id: "list-channels",
  description: "List all channels in the server",
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
          type: z.string(),
          parentId: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("list-channels", ctx.guildId, async () => {
      logger.debug("Listing channels", { guildId: ctx.guildId });
      try {
        const client = getDiscordClient();
        const guild = await client.guilds.fetch(ctx.guildId);
        const channels = await guild.channels.fetch();

        const channelList = channels.map((channel) => ({
          id: channel?.id ?? "",
          name: channel?.name ?? "",
          type: channel?.type !== undefined ? ChannelType[channel.type] : "Unknown",
          parentId: channel?.parentId ?? null,
        }));

        logger.info("Listed channels successfully", {
          guildId: ctx.guildId,
          channelCount: channelList.length,
        });

        return {
          success: true,
          message: `Found ${String(channelList.length)} channels`,
          data: channelList,
        };
      } catch (error) {
        logger.error("Failed to list channels", error, { guildId: ctx.guildId });
        captureException(error as Error, {
          operation: "tool.list-channels",
          discord: { guildId: ctx.guildId },
        });
        return {
          success: false,
          message: "Failed to list channels",
        };
      }
    });
  },
});

export const createChannelTool = createTool({
  id: "create-channel",
  description: "Create a new channel in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name of the channel"),
    type: z
      .enum(["text", "voice", "category"])
      .describe("Type of channel to create"),
    parentId: z
      .string()
      .optional()
      .describe("ID of the parent category"),
    topic: z.string().optional().describe("Topic for text channels"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        channelId: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      const typeMap = {
        text: ChannelType.GuildText,
        voice: ChannelType.GuildVoice,
        category: ChannelType.GuildCategory,
      } as const;

      const channelType = typeMap[ctx.type];

      const createOptions: {
        name: string;
        type: typeof channelType;
        parent?: string;
        topic?: string;
      } = {
        name: ctx.name,
        type: channelType,
      };
      if (ctx.parentId !== undefined) createOptions.parent = ctx.parentId;
      if (ctx.topic !== undefined) createOptions.topic = ctx.topic;

      const channel = await guild.channels.create(createOptions);

      return {
        success: true,
        message: `Created channel #${channel.name}`,
        data: {
          channelId: channel.id,
        },
      };
    } catch (error) {
      logger.error("Failed to create channel", error);
      return {
        success: false,
        message: "Failed to create channel",
      };
    }
  },
});

export const deleteChannelTool = createTool({
  id: "delete-channel",
  description: "Delete a channel from the server",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel to delete"),
    reason: z.string().optional().describe("Reason for deleting the channel"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel) {
        return {
          success: false,
          message: "Channel not found",
        };
      }

      if (!("delete" in channel)) {
        return {
          success: false,
          message: "Cannot delete this type of channel",
        };
      }

      await channel.delete(ctx.reason);

      return {
        success: true,
        message: "Channel deleted successfully",
      };
    } catch (error) {
      logger.error("Failed to delete channel", error);
      return {
        success: false,
        message: "Failed to delete channel",
      };
    }
  },
});

export const getChannelTool = createTool({
  id: "get-channel",
  description: "Get information about a specific channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        topic: z.string().nullable(),
        parentId: z.string().nullable(),
        position: z.number(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel) {
        return {
          success: false,
          message: "Channel not found",
        };
      }

      return {
        success: true,
        message: `Retrieved channel information`,
        data: {
          id: channel.id,
          name: "name" in channel ? (channel.name ?? "Unknown") : "Unknown",
          type: ChannelType[channel.type],
          topic: "topic" in channel ? channel.topic : null,
          parentId: "parentId" in channel ? channel.parentId : null,
          position: "position" in channel ? channel.position : 0,
        },
      };
    } catch (error) {
      logger.error("Failed to get channel", error);
      return {
        success: false,
        message: "Failed to get channel information",
      };
    }
  },
});

export const modifyChannelTool = createTool({
  id: "modify-channel",
  description: "Modify a channel's settings",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
    name: z.string().optional().describe("New name for the channel"),
    topic: z.string().optional().describe("New topic for the channel"),
    position: z.number().optional().describe("New position for the channel"),
    parentId: z.string().nullable().optional().describe("New parent category ID"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel || !("edit" in channel)) {
        return {
          success: false,
          message: "Channel not found or cannot be edited",
        };
      }

      const editOptions: GuildChannelEditOptions = {};
      if (ctx.name !== undefined) editOptions.name = ctx.name;
      if (ctx.topic !== undefined) editOptions.topic = ctx.topic;
      if (ctx.position !== undefined) editOptions.position = ctx.position;
      if (ctx.parentId !== undefined) editOptions.parent = ctx.parentId;

      await channel.edit(editOptions as Parameters<typeof channel.edit>[0]);

      return {
        success: true,
        message: "Channel updated successfully",
      };
    } catch (error) {
      logger.error("Failed to modify channel", error);
      return {
        success: false,
        message: "Failed to modify channel",
      };
    }
  },
});

export const reorderChannelsTool = createTool({
  id: "reorder-channels",
  description: "Reorder channels in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    positions: z
      .array(
        z.object({
          channelId: z.string(),
          position: z.number(),
        }),
      )
      .describe("Array of channel IDs and their new positions"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      await guild.channels.setPositions(
        ctx.positions.map((p: { channelId: string; position: number }) => ({
          channel: p.channelId,
          position: p.position,
        })),
      );

      return {
        success: true,
        message: `Reordered ${String(ctx.positions.length)} channels`,
      };
    } catch (error) {
      logger.error("Failed to reorder channels", error);
      return {
        success: false,
        message: "Failed to reorder channels",
      };
    }
  },
});

export const setChannelPermissionsTool = createTool({
  id: "set-channel-permissions",
  description: "Set permission overwrites for a channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
    targetId: z.string().describe("The ID of the role or user"),
    targetType: z.enum(["role", "member"]).describe("Whether the target is a role or member"),
    allow: z.array(z.string()).optional().describe("Permissions to allow"),
    deny: z.array(z.string()).optional().describe("Permissions to deny"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel || !("permissionOverwrites" in channel)) {
        return {
          success: false,
          message: "Channel not found or does not support permissions",
        };
      }

      await channel.permissionOverwrites.edit(ctx.targetId, {
        ...(ctx.allow?.reduce(
          (acc: Record<string, boolean>, perm: string) => ({ ...acc, [normalizePermissionName(perm)]: true }),
          {},
        ) ?? {}),
        ...(ctx.deny?.reduce(
          (acc: Record<string, boolean>, perm: string) => ({ ...acc, [normalizePermissionName(perm)]: false }),
          {},
        ) ?? {}),
      });

      return {
        success: true,
        message: "Channel permissions updated successfully",
      };
    } catch (error) {
      logger.error("Failed to set channel permissions", error);
      return {
        success: false,
        message: "Failed to set channel permissions",
      };
    }
  },
});

export const channelTools = [
  listChannelsTool,
  createChannelTool,
  deleteChannelTool,
  getChannelTool,
  modifyChannelTool,
  reorderChannelsTool,
  setChannelPermissionsTool,
];
