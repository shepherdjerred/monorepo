import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

export const musicQueueTool = createTool({
  id: "music-queue",
  description:
    "Manage music queue: get queue, add track, remove track, shuffle, or clear",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["get", "add", "remove", "shuffle", "clear"])
      .describe("The action to perform"),
    query: z.string().optional().describe("Song name or URL (for add)"),
    position: z
      .number()
      .optional()
      .describe("Track position 1-based (for remove)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          currentTrack: z
            .object({ title: z.string(), duration: z.string() })
            .nullable(),
          tracks: z.array(
            z.object({
              position: z.number(),
              title: z.string(),
              duration: z.string(),
            }),
          ),
          totalTracks: z.number(),
        }),
        z.object({
          title: z.string(),
          duration: z.string(),
          position: z.number(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId);

      switch (ctx.action) {
        case "get": {
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          const currentTrack = queue.currentTrack == null
            ? null
            : {
                title: queue.currentTrack.title,
                duration: queue.currentTrack.duration,
              };
          const tracks = queue.tracks.toArray().map((t, i) => ({
            position: i + 1,
            title: t.title,
            duration: t.duration,
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
        }

        case "add": {
          if (ctx.query == null || ctx.query.length === 0) {
            return { success: false, message: "query is required for add" };
          }
          if (queue == null) {
            return {
              success: false,
              message: "No active queue. Use play to start first.",
            };
          }
          const result = await player.search(ctx.query);
          if (!result.hasTracks()) {
            return { success: false, message: "No tracks found" };
          }
          const track = result.tracks[0];
          if (track == null) {
            return { success: false, message: "No tracks found" };
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
        }

        case "remove": {
          if (ctx.position === undefined) {
            return {
              success: false,
              message: "position is required for remove",
            };
          }
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          const index = ctx.position - 1;
          if (index < 0 || index >= queue.tracks.size) {
            return { success: false, message: "Invalid position" };
          }
          const track = queue.tracks.toArray()[index];
          queue.removeTrack(index);
          return {
            success: true,
            message: `Removed: ${track?.title ?? "Unknown"}`,
          };
        }

        case "shuffle": {
          if (!queue || queue.tracks.size === 0) {
            return { success: false, message: "No tracks to shuffle" };
          }
          queue.tracks.shuffle();
          return { success: true, message: "Queue shuffled" };
        }

        case "clear": {
          if (queue == null) {
            return { success: false, message: "No active queue" };
          }
          queue.tracks.clear();
          return { success: true, message: "Queue cleared" };
        }
      }
    } catch (error) {
      logger.error("Failed music queue action", error);
      return { success: false, message: "Failed to perform queue action" };
    }
  },
});

export const queueTools = [musicQueueTool];
