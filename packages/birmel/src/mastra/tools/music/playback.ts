import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { QueryType, QueueRepeatMode } from "discord-player";
import type { VoiceChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

export const musicPlaybackTool = createTool({
  id: "music-playback",
  description:
    "Control music playback: play, pause, resume, skip, stop, seek, set volume, set loop mode, or get now playing",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum([
        "play",
        "pause",
        "resume",
        "skip",
        "stop",
        "seek",
        "set-volume",
        "set-loop",
        "now-playing",
      ])
      .describe("The action to perform"),
    channelId: z
      .string()
      .optional()
      .describe("Text channel ID for responses (for play)"),
    voiceChannelId: z
      .string()
      .optional()
      .describe("Voice channel ID (for play)"),
    query: z.string().optional().describe("URL or search query (for play)"),
    seconds: z
      .number()
      .min(0)
      .optional()
      .describe("Position in seconds (for seek)"),
    volume: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Volume level 0-100 (for set-volume)"),
    loopMode: z
      .enum(["off", "track", "queue", "autoplay"])
      .optional()
      .describe("Loop mode (for set-loop)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        title: z.string(),
        duration: z.string(),
        url: z.string(),
        progress: z.string().optional(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId);

      switch (ctx.action) {
        case "play": {
          if ((ctx.channelId == null || ctx.channelId.length === 0) || (ctx.voiceChannelId == null || ctx.voiceChannelId.length === 0) || (ctx.query == null || ctx.query.length === 0)) {
            return {
              success: false,
              message:
                "channelId, voiceChannelId, and query are required for play",
            };
          }
          const client = getDiscordClient();
          const channel = await client.channels.fetch(ctx.channelId);
          const voiceChannel = await client.channels.fetch(ctx.voiceChannelId);
          if (voiceChannel?.isVoiceBased() !== true) {
            return { success: false, message: "Invalid voice channel" };
          }
          const searchResult = await player.search(ctx.query, {
            ...(client.user != null && { requestedBy: client.user }),
            searchEngine: QueryType.AUTO,
          });
          if (!searchResult.hasTracks()) {
            return { success: false, message: "No results found" };
          }
          const result = await player.play(
            voiceChannel as VoiceChannel,
            searchResult,
            {
              nodeOptions: {
                metadata: channel,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 60_000,
                leaveOnEnd: false,
                leaveOnEndCooldown: 60_000,
              },
            },
          );
          const track = result.track;
          logger.info("Music playback started", {
            guildId: ctx.guildId,
            track: track.title,
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
        }

        case "pause": {
          if (queue?.isPlaying() !== true) {
            return { success: false, message: "Nothing is playing" };
          }
          queue.node.pause();
          return { success: true, message: "Paused playback" };
        }

        case "resume": {
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          queue.node.resume();
          return { success: true, message: "Resumed playback" };
        }

        case "skip": {
          if (queue?.isPlaying() !== true) {
            return { success: false, message: "Nothing is playing" };
          }
          const track = queue.currentTrack;
          queue.node.skip();
          return {
            success: true,
            message: `Skipped: ${track?.title ?? "Unknown"}`,
          };
        }

        case "stop": {
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          queue.delete();
          return {
            success: true,
            message: "Stopped playback and cleared queue",
          };
        }

        case "seek": {
          if (ctx.seconds === undefined) {
            return { success: false, message: "seconds is required for seek" };
          }
          if (queue?.isPlaying() !== true) {
            return { success: false, message: "Nothing is playing" };
          }
          const success = await queue.node.seek(ctx.seconds * 1000);
          if (!success) {
            return { success: false, message: "Failed to seek" };
          }
          const mins = Math.floor(ctx.seconds / 60);
          const secs = ctx.seconds % 60;
          return {
            success: true,
            message: `Seeked to ${String(mins)}:${String(secs).padStart(2, "0")}`,
          };
        }

        case "set-volume": {
          if (ctx.volume === undefined) {
            return {
              success: false,
              message: "volume is required for set-volume",
            };
          }
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          queue.node.setVolume(ctx.volume);
          return {
            success: true,
            message: `Volume set to ${String(ctx.volume)}%`,
          };
        }

        case "set-loop": {
          if (ctx.loopMode == null || ctx.loopMode.length === 0) {
            return {
              success: false,
              message: "loopMode is required for set-loop",
            };
          }
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          const modeMap = {
            off: QueueRepeatMode.OFF,
            track: QueueRepeatMode.TRACK,
            queue: QueueRepeatMode.QUEUE,
            autoplay: QueueRepeatMode.AUTOPLAY,
          };
          queue.setRepeatMode(modeMap[ctx.loopMode]);
          return { success: true, message: `Loop mode set to ${ctx.loopMode}` };
        }

        case "now-playing": {
          if (queue?.isPlaying() !== true || !queue.currentTrack) {
            return { success: false, message: "Nothing is playing" };
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
        }
      }
    } catch (error) {
      logger.error("Failed music playback action", error);
      return { success: false, message: "Failed to perform music action" };
    }
  },
});

export const playbackTools = [musicPlaybackTool];
