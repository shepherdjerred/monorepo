import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

export const getQueueTool = createTool({
  id: "get-queue",
  description: "Get the current music queue",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        currentTrack: z
          .object({
            title: z.string(),
            duration: z.string(),
          })
          .nullable(),
        tracks: z.array(
          z.object({
            position: z.number(),
            title: z.string(),
            duration: z.string(),
          }),
        ),
        totalTracks: z.number(),
      })
      .optional(),
  }),
  execute: async ({ guildId }) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      const currentTrack = queue.currentTrack
        ? {
            title: queue.currentTrack.title,
            duration: queue.currentTrack.duration,
          }
        : null;

      const tracks = queue.tracks.toArray().map((track, index) => ({
        position: index + 1,
        title: track.title,
        duration: track.duration,
      }));

      return {
        success: true,
        message: `Queue has ${String(tracks.length)} tracks`,
        data: {
          currentTrack,
          tracks: tracks.slice(0, 10),
          totalTracks: tracks.length,
        },
      };
    } catch (error) {
      logger.error("Failed to get queue", error);
      return {
        success: false,
        message: "Failed to get queue",
      };
    }
  },
});

export const shuffleQueueTool = createTool({
  id: "shuffle-queue",
  description: "Shuffle the music queue",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ guildId }) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(guildId);

      if (!queue || queue.tracks.size === 0) {
        return {
          success: false,
          message: "No tracks in queue to shuffle",
        };
      }

      queue.tracks.shuffle();

      return {
        success: true,
        message: "Queue shuffled",
      };
    } catch (error) {
      logger.error("Failed to shuffle queue", error);
      return {
        success: false,
        message: "Failed to shuffle queue",
      };
    }
  },
});

export const clearQueueTool = createTool({
  id: "clear-queue",
  description: "Clear all tracks from the queue (keeps current track playing)",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ guildId }) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      queue.tracks.clear();

      return {
        success: true,
        message: "Queue cleared",
      };
    } catch (error) {
      logger.error("Failed to clear queue", error);
      return {
        success: false,
        message: "Failed to clear queue",
      };
    }
  },
});

export const removeFromQueueTool = createTool({
  id: "remove-from-queue",
  description: "Remove a track from the queue by position",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    position: z.number().describe("Position of the track to remove (1-based)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ guildId, position }) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue",
        };
      }

      const index = position - 1;
      if (index < 0 || index >= queue.tracks.size) {
        return {
          success: false,
          message: "Invalid position",
        };
      }

      const track = queue.tracks.toArray()[index];
      queue.removeTrack(index);

      return {
        success: true,
        message: `Removed: ${track?.title ?? "Unknown track"}`,
      };
    } catch (error) {
      logger.error("Failed to remove from queue", error);
      return {
        success: false,
        message: "Failed to remove from queue",
      };
    }
  },
});

export const addToQueueTool = createTool({
  id: "add-to-queue",
  description: "Add a track to the queue without starting playback",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    query: z.string().describe("The song name or URL to add to the queue"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        title: z.string(),
        duration: z.string(),
        position: z.number(),
      })
      .optional(),
  }),
  execute: async ({ guildId, query }) => {
    await Promise.resolve();
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(guildId);

      if (!queue) {
        return {
          success: false,
          message: "No active queue. Use 'play' command to start playback first.",
        };
      }

      const result = await player.search(query);

      if (!result.hasTracks()) {
        return {
          success: false,
          message: "No tracks found for the query",
        };
      }

      const track = result.tracks[0];
      if (!track) {
        return {
          success: false,
          message: "No tracks found for the query",
        };
      }

      queue.addTrack(track);

      return {
        success: true,
        message: `Added to queue: ${track.title}`,
        data: {
          title: track.title,
          duration: track.duration,
          position: queue.tracks.size,
        },
      };
    } catch (error) {
      logger.error("Failed to add to queue", error);
      return {
        success: false,
        message: "Failed to add track to queue",
      };
    }
  },
});

export const queueTools = [
  getQueueTool,
  addToQueueTool,
  shuffleQueueTool,
  clearQueueTool,
  removeFromQueueTool,
];
