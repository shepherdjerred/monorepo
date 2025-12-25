import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/index.js";

export const manageBotVoiceTool = createTool({
  id: "manage-bot-voice",
  description: "Manage the bot's voice channel connection: join or leave a voice channel",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["join", "leave"]).describe("The action to perform"),
    channelId: z.string().optional().describe("The ID of the voice channel (required for join)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "join": {
          if (!ctx.channelId) {
            return {
              success: false,
              message: "channelId is required for joining a voice channel",
            };
          }
          const client = getDiscordClient();
          const channel = await client.channels.fetch(ctx.channelId);

          if (!channel?.isVoiceBased()) {
            return {
              success: false,
              message: "Invalid voice channel",
            };
          }

          const voiceChannel = channel as VoiceChannel;

          joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: ctx.guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });

          return {
            success: true,
            message: `Joined voice channel: ${voiceChannel.name}`,
          };
        }

        case "leave": {
          const connection = getVoiceConnection(ctx.guildId);

          if (!connection) {
            return {
              success: false,
              message: "Not connected to a voice channel",
            };
          }

          connection.destroy();

          return {
            success: true,
            message: "Left voice channel",
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage bot voice", error as Error);
      return {
        success: false,
        message: "Failed to manage bot voice connection",
      };
    }
  },
});

export const manageVoiceMemberTool = createTool({
  id: "manage-voice-member",
  description: "Manage a member in voice: move to channel, disconnect, server mute, or server deafen",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    action: z.enum(["move", "disconnect", "mute", "deafen"]).describe("The action to perform"),
    channelId: z.string().optional().describe("Target voice channel ID (required for move)"),
    mute: z.boolean().optional().describe("Whether to mute (true) or unmute (false) - for mute action"),
    deaf: z.boolean().optional().describe("Whether to deafen (true) or undeafen (false) - for deafen action"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const member = await guild.members.fetch(ctx.memberId);

      switch (ctx.action) {
        case "move": {
          if (!ctx.channelId) {
            return {
              success: false,
              message: "channelId is required for moving a member",
            };
          }
          if (!member.voice.channel) {
            return {
              success: false,
              message: "Member is not in a voice channel",
            };
          }
          await member.voice.setChannel(ctx.channelId, ctx.reason);
          return {
            success: true,
            message: `Moved ${member.displayName} to new channel`,
          };
        }

        case "disconnect": {
          if (!member.voice.channel) {
            return {
              success: false,
              message: "Member is not in a voice channel",
            };
          }
          await member.voice.disconnect(ctx.reason);
          return {
            success: true,
            message: `Disconnected ${member.displayName} from voice`,
          };
        }

        case "mute": {
          if (ctx.mute === undefined) {
            return {
              success: false,
              message: "mute parameter is required for mute action",
            };
          }
          await member.voice.setMute(ctx.mute, ctx.reason);
          return {
            success: true,
            message: `${ctx.mute ? "Muted" : "Unmuted"} ${member.displayName}`,
          };
        }

        case "deafen": {
          if (ctx.deaf === undefined) {
            return {
              success: false,
              message: "deaf parameter is required for deafen action",
            };
          }
          await member.voice.setDeaf(ctx.deaf, ctx.reason);
          return {
            success: true,
            message: `${ctx.deaf ? "Deafened" : "Undeafened"} ${member.displayName}`,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage voice member", error as Error);
      return {
        success: false,
        message: "Failed to manage voice member",
      };
    }
  },
});

export const voiceTools = [manageBotVoiceTool, manageVoiceMemberTool];
