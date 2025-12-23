import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const listInvitesTool = createTool({
  id: "list-invites",
  description: "List all invites for the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          code: z.string(),
          url: z.string(),
          channelId: z.string().nullable(),
          inviterId: z.string().nullable(),
          uses: z.number().nullable(),
          maxUses: z.number().nullable(),
          expiresAt: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const invites = await guild.invites.fetch();

      const inviteList = invites.map((invite) => ({
        code: invite.code,
        url: invite.url,
        channelId: invite.channelId,
        inviterId: invite.inviterId,
        uses: invite.uses,
        maxUses: invite.maxUses,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
      }));

      return {
        success: true,
        message: `Found ${String(inviteList.length)} invites`,
        data: inviteList,
      };
    } catch (error) {
      logger.error("Failed to list invites", error);
      return {
        success: false,
        message: "Failed to list invites",
      };
    }
  },
});

export const createInviteTool = createTool({
  id: "create-invite",
  description: "Create a new invite link for a channel",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel"),
    maxAge: z
      .number()
      .optional()
      .describe("Invite expiry in seconds (0 for never)"),
    maxUses: z
      .number()
      .optional()
      .describe("Maximum number of uses (0 for unlimited)"),
    temporary: z
      .boolean()
      .optional()
      .describe("Whether membership is temporary"),
    reason: z.string().optional().describe("Reason for creating the invite"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        code: z.string(),
        url: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.context.channelId);

      if (!channel || !("createInvite" in channel)) {
        return {
          success: false,
          message: "Cannot create invite for this channel type",
        };
      }

      const invite = await (channel as TextChannel).createInvite({
        ...(ctx.context.maxAge !== undefined && { maxAge: ctx.context.maxAge }),
        ...(ctx.context.maxUses !== undefined && { maxUses: ctx.context.maxUses }),
        ...(ctx.context.temporary !== undefined && { temporary: ctx.context.temporary }),
        ...(ctx.context.reason !== undefined && { reason: ctx.context.reason }),
      });

      return {
        success: true,
        message: `Created invite: ${invite.url}`,
        data: {
          code: invite.code,
          url: invite.url,
        },
      };
    } catch (error) {
      logger.error("Failed to create invite", error);
      return {
        success: false,
        message: "Failed to create invite",
      };
    }
  },
});

export const deleteInviteTool = createTool({
  id: "delete-invite",
  description: "Delete/revoke an invite",
  inputSchema: z.object({
    inviteCode: z.string().describe("The invite code to delete"),
    reason: z.string().optional().describe("Reason for deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const invite = await client.fetchInvite(ctx.context.inviteCode);

      await invite.delete(ctx.context.reason);

      return {
        success: true,
        message: `Deleted invite ${ctx.context.inviteCode}`,
      };
    } catch (error) {
      logger.error("Failed to delete invite", error);
      return {
        success: false,
        message: "Failed to delete invite",
      };
    }
  },
});

export const getVanityUrlTool = createTool({
  id: "get-vanity-url",
  description: "Get the vanity URL for the server (if available)",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        code: z.string().nullable(),
        uses: z.number(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);

      const vanity = await guild.fetchVanityData();

      if (!vanity.code) {
        return {
          success: true,
          message: "Server does not have a vanity URL",
          data: {
            code: null,
            uses: 0,
          },
        };
      }

      return {
        success: true,
        message: `Vanity URL: discord.gg/${vanity.code}`,
        data: {
          code: vanity.code,
          uses: vanity.uses,
        },
      };
    } catch (error) {
      logger.error("Failed to get vanity URL", error);
      return {
        success: false,
        message: "Failed to get vanity URL. Server may not have the required boost level.",
      };
    }
  },
});

export const inviteTools = [listInvitesTool, createInviteTool, deleteInviteTool, getVanityUrlTool];
