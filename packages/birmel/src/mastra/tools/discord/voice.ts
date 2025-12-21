import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/index.js";

export const joinVoiceChannelTool = createTool({
  id: "join-voice-channel",
  description: "Join a voice channel",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().describe("The ID of the voice channel to join"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(context.channelId);

      if (!channel?.isVoiceBased()) {
        return {
          success: false,
          message: "Invalid voice channel",
        };
      }

      const voiceChannel = channel as VoiceChannel;

      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: context.guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      return {
        success: true,
        message: `Joined voice channel: ${voiceChannel.name}`,
      };
    } catch (error) {
      logger.error("Failed to join voice channel", error as Error);
      return {
        success: false,
        message: "Failed to join voice channel",
      };
    }
  },
});

export const leaveVoiceChannelTool = createTool({
  id: "leave-voice-channel",
  description: "Leave the current voice channel",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    await Promise.resolve();
    try {
      const connection = getVoiceConnection(context.guildId);

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
    } catch (error) {
      logger.error("Failed to leave voice channel", error as Error);
      return {
        success: false,
        message: "Failed to leave voice channel",
      };
    }
  },
});

export const moveMemberToChannelTool = createTool({
  id: "move-member-to-channel",
  description: "Move a member to a different voice channel",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to move"),
    channelId: z.string().describe("The ID of the target voice channel"),
    reason: z.string().optional().describe("Reason for moving the member"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      if (!member.voice.channel) {
        return {
          success: false,
          message: "Member is not in a voice channel",
        };
      }

      await member.voice.setChannel(context.channelId, context.reason);

      return {
        success: true,
        message: `Moved ${member.displayName} to new channel`,
      };
    } catch (error) {
      logger.error("Failed to move member", error as Error);
      return {
        success: false,
        message: "Failed to move member to channel",
      };
    }
  },
});

export const disconnectMemberTool = createTool({
  id: "disconnect-member",
  description: "Disconnect a member from voice",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member to disconnect"),
    reason: z.string().optional().describe("Reason for disconnecting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      if (!member.voice.channel) {
        return {
          success: false,
          message: "Member is not in a voice channel",
        };
      }

      await member.voice.disconnect(context.reason);

      return {
        success: true,
        message: `Disconnected ${member.displayName} from voice`,
      };
    } catch (error) {
      logger.error("Failed to disconnect member", error as Error);
      return {
        success: false,
        message: "Failed to disconnect member",
      };
    }
  },
});

export const serverMuteMemberTool = createTool({
  id: "server-mute-member",
  description: "Server mute or unmute a member in voice",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    mute: z.boolean().describe("Whether to mute (true) or unmute (false)"),
    reason: z.string().optional().describe("Reason for muting/unmuting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      await member.voice.setMute(context.mute, context.reason);

      return {
        success: true,
        message: `${context.mute ? "Muted" : "Unmuted"} ${member.displayName}`,
      };
    } catch (error) {
      logger.error("Failed to mute/unmute member", error as Error);
      return {
        success: false,
        message: "Failed to mute/unmute member",
      };
    }
  },
});

export const serverDeafenMemberTool = createTool({
  id: "server-deafen-member",
  description: "Server deafen or undeafen a member in voice",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    memberId: z.string().describe("The ID of the member"),
    deaf: z.boolean().describe("Whether to deafen (true) or undeafen (false)"),
    reason: z.string().optional().describe("Reason for deafening/undeafening"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(context.guildId);
      const member = await guild.members.fetch(context.memberId);

      await member.voice.setDeaf(context.deaf, context.reason);

      return {
        success: true,
        message: `${context.deaf ? "Deafened" : "Undeafened"} ${member.displayName}`,
      };
    } catch (error) {
      logger.error("Failed to deafen/undeafen member", error as Error);
      return {
        success: false,
        message: "Failed to deafen/undeafen member",
      };
    }
  },
});

export const voiceTools = [
  joinVoiceChannelTool,
  leaveVoiceChannelTool,
  moveMemberToChannelTool,
  disconnectMemberTool,
  serverMuteMemberTool,
  serverDeafenMemberTool,
];
