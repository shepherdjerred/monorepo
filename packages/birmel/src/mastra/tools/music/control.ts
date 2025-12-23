import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { QueueRepeatMode } from "discord-player";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

export const setVolumeTool = createTool({
  id: "set-volume",
  description: "Set the playback volume",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    volume: z.number().min(0).max(100).describe("Volume level (0-100)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      queue.node.setVolume(ctx.volume);

      return {
        success: true,
        message: `Volume set to ${String(ctx.volume)}%`,
      };
    } catch (error) {
      logger.error("Failed to set volume", error);
      return {
        success: false,
        message: "Failed to set volume",
      };
    }
  },
});

export const setLoopModeTool = createTool({
  id: "set-loop-mode",
  description: "Set the loop/repeat mode",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    mode: z
      .enum(["off", "track", "queue", "autoplay"])
      .describe("Loop mode: off, track, queue, or autoplay"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      const modeMap = {
        off: QueueRepeatMode.OFF,
        track: QueueRepeatMode.TRACK,
        queue: QueueRepeatMode.QUEUE,
        autoplay: QueueRepeatMode.AUTOPLAY,
      };

      queue.setRepeatMode(modeMap[ctx.mode]);

      return {
        success: true,
        message: `Loop mode set to ${ctx.mode}`,
      };
    } catch (error) {
      logger.error("Failed to set loop mode", error);
      return {
        success: false,
        message: "Failed to set loop mode",
      };
    }
  },
});

export const seekTool = createTool({
  id: "seek",
  description: "Seek to a position in the current track",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    seconds: z.number().min(0).describe("Position to seek to in seconds"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId);

      if (!queue?.isPlaying()) {
        return {
          success: false,
          message: "Nothing is currently playing",
        };
      }

      const success = await queue.node.seek(ctx.seconds * 1000);

      if (!success) {
        return {
          success: false,
          message: "Failed to seek",
        };
      }

      const minutes = Math.floor(ctx.seconds / 60);
      const secs = ctx.seconds % 60;

      return {
        success: true,
        message: `Seeked to ${String(minutes)}:${String(secs).padStart(2, "0")}`,
      };
    } catch (error) {
      logger.error("Failed to seek", error);
      return {
        success: false,
        message: "Failed to seek",
      };
    }
  },
});

export const controlTools = [setVolumeTool, setLoopModeTool, seekTool];
