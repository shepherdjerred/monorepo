import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/index.ts";
import {
  handlePlay,
  handlePause,
  handleResume,
  handleSkip,
  handleStop,
  handleSeek,
  handleSetVolume,
  handleSetLoop,
  handleNowPlaying,
} from "./playback-actions.ts";

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
      switch (ctx.action) {
        case "play":
          return await handlePlay(
            ctx.guildId,
            ctx.channelId,
            ctx.voiceChannelId,
            ctx.query,
          );
        case "pause":
          return handlePause(ctx.guildId);
        case "resume":
          return handleResume(ctx.guildId);
        case "skip":
          return handleSkip(ctx.guildId);
        case "stop":
          return handleStop(ctx.guildId);
        case "seek":
          return await handleSeek(ctx.guildId, ctx.seconds);
        case "set-volume":
          return handleSetVolume(ctx.guildId, ctx.volume);
        case "set-loop":
          return handleSetLoop(ctx.guildId, ctx.loopMode);
        case "now-playing":
          return handleNowPlaying(ctx.guildId);
      }
    } catch (error) {
      logger.error("Failed music playback action", error);
      return { success: false, message: "Failed to perform music action" };
    }
  },
});

export const playbackTools = [musicPlaybackTool];
