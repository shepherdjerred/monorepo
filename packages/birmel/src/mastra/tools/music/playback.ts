import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { QueryType } from "discord-player";
import type { VoiceChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

export const playMusicTool = createTool({
  id: "play-music",
  description: "Play music from a URL or search query",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().describe("The text channel ID for responses"),
    voiceChannelId: z.string().describe("The voice channel ID to play in"),
    query: z.string().describe("URL or search query for the music"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        title: z.string(),
        duration: z.string(),
        url: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    const startTime = Date.now();

    logger.info("Play music request", {
      guildId: input.guildId,
      channelId: input.channelId,
      voiceChannelId: input.voiceChannelId,
      query: input.query.slice(0, 100),
    });

    try {
      const client = getDiscordClient();
      const player = getMusicPlayer();

      logger.debug("Fetching channels", {
        channelId: input.channelId,
        voiceChannelId: input.voiceChannelId,
      });

      const channel = await client.channels.fetch(input.channelId);
      const voiceChannel = await client.channels.fetch(input.voiceChannelId);

      if (!voiceChannel?.isVoiceBased()) {
        logger.warn("Invalid voice channel", { voiceChannelId: input.voiceChannelId });
        return {
          success: false,
          message: "Invalid voice channel",
        };
      }

      logger.debug("Searching for track", { query: input.query });
      const searchResult = await player.search(input.query, {
        ...(client.user && { requestedBy: client.user }),
        searchEngine: QueryType.AUTO,
      });

      if (!searchResult.hasTracks()) {
        logger.info("No tracks found", { query: input.query });
        return {
          success: false,
          message: "No results found for your query",
        };
      }

      logger.debug("Playing track", {
        trackCount: searchResult.tracks.length,
        firstTrack: searchResult.tracks[0]?.title,
      });

      const result = await player.play(voiceChannel as VoiceChannel, searchResult, {
        nodeOptions: {
          metadata: channel,
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 60000,
          leaveOnEnd: false,
          leaveOnEndCooldown: 60000,
        },
      });

      const track = result.track;
      const duration = Date.now() - startTime;

      logger.info("Music playback started", {
        guildId: input.guildId,
        trackTitle: track.title,
        trackUrl: track.url,
        durationMs: duration,
      });

      return {
        success: true,
        message: `Playing: ${track.title}`,
        data: {
          title: track.title,
          duration: track.duration,
          url: track.url,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Failed to play music", {
        error,
        guildId: input.guildId,
        query: input.query,
        durationMs: duration,
      });
      return {
        success: false,
        message: "Failed to play music",
      };
    }
  },
});

export const pauseMusicTool = createTool({
  id: "pause-music",
  description: "Pause the current playback",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(input.guildId);

      if (!queue?.isPlaying()) {
        return {
          success: false,
          message: "Nothing is currently playing",
        };
      }

      queue.node.pause();

      return {
        success: true,
        message: "Paused playback",
      };
    } catch (error) {
      logger.error("Failed to pause music", error);
      return {
        success: false,
        message: "Failed to pause music",
      };
    }
  },
});

export const resumeMusicTool = createTool({
  id: "resume-music",
  description: "Resume paused playback",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(input.guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      queue.node.resume();

      return {
        success: true,
        message: "Resumed playback",
      };
    } catch (error) {
      logger.error("Failed to resume music", error);
      return {
        success: false,
        message: "Failed to resume music",
      };
    }
  },
});

export const skipTrackTool = createTool({
  id: "skip-track",
  description: "Skip the current track",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(input.guildId);

      if (!queue?.isPlaying()) {
        return {
          success: false,
          message: "Nothing is currently playing",
        };
      }

      const currentTrack = queue.currentTrack;
      queue.node.skip();

      return {
        success: true,
        message: `Skipped: ${currentTrack?.title ?? "Unknown track"}`,
      };
    } catch (error) {
      logger.error("Failed to skip track", error);
      return {
        success: false,
        message: "Failed to skip track",
      };
    }
  },
});

export const stopMusicTool = createTool({
  id: "stop-music",
  description: "Stop playback and clear the queue",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(input.guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      queue.delete();

      return {
        success: true,
        message: "Stopped playback and cleared queue",
      };
    } catch (error) {
      logger.error("Failed to stop music", error);
      return {
        success: false,
        message: "Failed to stop music",
      };
    }
  },
});

export const nowPlayingTool = createTool({
  id: "now-playing",
  description: "Get information about the currently playing track",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        title: z.string(),
        duration: z.string(),
        url: z.string(),
        progress: z.string(),
      })
      .optional(),
  }),
  execute: async (input) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(input.guildId);

      if (!queue?.isPlaying() || !queue.currentTrack) {
        return {
          success: false,
          message: "Nothing is currently playing",
        };
      }

      const track = queue.currentTrack;
      const progress = queue.node.createProgressBar();

      return {
        success: true,
        message: `Now playing: ${track.title}`,
        data: {
          title: track.title,
          duration: track.duration,
          url: track.url,
          progress: progress ?? "",
        },
      };
    } catch (error) {
      logger.error("Failed to get now playing", error);
      return {
        success: false,
        message: "Failed to get now playing info",
      };
    }
  },
});

export const playbackTools = [
  playMusicTool,
  pauseMusicTool,
  resumeMusicTool,
  skipTrackTool,
  stopMusicTool,
  nowPlayingTool,
];
