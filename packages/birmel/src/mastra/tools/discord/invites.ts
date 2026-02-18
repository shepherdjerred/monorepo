import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import type { TextChannel } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/index.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSnowflakes } from "./validation.ts";

export const manageInviteTool = createTool({
  id: "manage-invite",
  description:
    "Manage server invites: list all, create new, delete existing, or get vanity URL",
  inputSchema: z.object({
    action: z
      .enum(["list", "create", "delete", "get-vanity"])
      .describe("The action to perform"),
    guildId: z
      .string()
      .optional()
      .describe("The ID of the guild (required for list/get-vanity)"),
    channelId: z
      .string()
      .optional()
      .describe("The ID of the channel (required for create)"),
    inviteCode: z
      .string()
      .optional()
      .describe("The invite code (required for delete)"),
    maxAge: z
      .number()
      .optional()
      .describe("Invite expiry in seconds, 0 for never (for create)"),
    maxUses: z
      .number()
      .optional()
      .describe("Maximum uses, 0 for unlimited (for create)"),
    temporary: z
      .boolean()
      .optional()
      .describe("Whether membership is temporary (for create)"),
    reason: z.string().optional().describe("Reason for creating/deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            code: z.string(),
            url: z.string(),
            channelId: z.string().nullable(),
            inviterId: z.string().nullable(),
            uses: z.number().nullable(),
            maxUses: z.number().nullable(),
            expiresAt: z.string().nullable(),
          }),
        ),
        z.object({
          code: z.string(),
          url: z.string(),
        }),
        z.object({
          code: z.string().nullable(),
          uses: z.number(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.channelId, fieldName: "channelId" },
      ]);
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      const client = getDiscordClient();

      switch (ctx.action) {
        case "list": {
          if (ctx.guildId == null || ctx.guildId.length === 0) {
            return {
              success: false,
              message: "guildId is required for listing invites",
            };
          }
          const guild = await client.guilds.fetch(ctx.guildId);
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
        }

        case "create": {
          if (ctx.channelId == null || ctx.channelId.length === 0) {
            return {
              success: false,
              message: "channelId is required for creating an invite",
            };
          }
          const channel = await client.channels.fetch(ctx.channelId);
          if (!channel || !("createInvite" in channel)) {
            return {
              success: false,
              message: "Cannot create invite for this channel type",
            };
          }
          const invite = await (channel as TextChannel).createInvite({
            ...(ctx.maxAge !== undefined && { maxAge: ctx.maxAge }),
            ...(ctx.maxUses !== undefined && { maxUses: ctx.maxUses }),
            ...(ctx.temporary !== undefined && { temporary: ctx.temporary }),
            ...(ctx.reason !== undefined && { reason: ctx.reason }),
          });
          return {
            success: true,
            message: `Created invite: ${invite.url}`,
            data: {
              code: invite.code,
              url: invite.url,
            },
          };
        }

        case "delete": {
          if (ctx.inviteCode == null || ctx.inviteCode.length === 0) {
            return {
              success: false,
              message: "inviteCode is required for deleting an invite",
            };
          }
          const invite = await client.fetchInvite(ctx.inviteCode);
          await invite.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted invite ${ctx.inviteCode}`,
          };
        }

        case "get-vanity": {
          if (ctx.guildId == null || ctx.guildId.length === 0) {
            return {
              success: false,
              message: "guildId is required for getting vanity URL",
            };
          }
          const guild = await client.guilds.fetch(ctx.guildId);
          const vanity = await guild.fetchVanityData();
          if (vanity.code == null || vanity.code.length === 0) {
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
        }
      }
    } catch (error) {
      logger.error("Failed to manage invite", error);
      return {
        success: false,
        message: `Failed to manage invite: ${(error as Error).message}`,
      };
    }
  },
});

export const inviteTools = [manageInviteTool];
