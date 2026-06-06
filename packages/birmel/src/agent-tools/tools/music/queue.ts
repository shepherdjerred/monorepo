import {
  QueryType,
  type GuildQueue,
  type Player,
  type Track,
} from "discord-player";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { getMusicPlayer } from "@shepherdjerred/birmel/music/player.ts";
import {
  buildActionEmbed,
  buildQueueEmbed,
} from "@shepherdjerred/birmel/music/embeds.ts";
import {
  normalizeTrack,
  sumDurations,
  type MusicTrackInfo,
} from "@shepherdjerred/birmel/music/metadata.ts";
import { sendMusicEmbed } from "@shepherdjerred/birmel/music/responses.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

type QueueResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

function getQueuedTracks(queue: GuildQueue): Track[] {
  return queue.tracks.toArray();
}

function buildQueueData(queue: GuildQueue): {
  currentTrack: MusicTrackInfo | null;
  tracks: MusicTrackInfo[];
  totalTracks: number;
  totalDuration?: string;
} {
  const tracks = getQueuedTracks(queue).map((track) => normalizeTrack(track));
  const totalDuration = sumDurations(tracks);
  return {
    currentTrack:
      queue.currentTrack == null ? null : normalizeTrack(queue.currentTrack),
    tracks: tracks.slice(0, 10),
    totalTracks: tracks.length,
    ...(totalDuration != null && { totalDuration }),
  };
}

async function handleGetQueue(
  queue: GuildQueue | undefined,
): Promise<QueueResult> {
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  const data = buildQueueData(queue);
  await sendMusicEmbed(
    buildQueueEmbed({
      currentTrack: data.currentTrack,
      tracks: getQueuedTracks(queue).map((track) => normalizeTrack(track)),
      totalTracks: data.totalTracks,
    }),
  );
  return {
    success: true,
    message: `Queue has ${String(data.totalTracks)} tracks`,
    data,
  };
}

async function searchFirstTrack(
  player: Player,
  query: string,
): Promise<Track | undefined> {
  const client = getDiscordClient();
  const result = await player.search(query, {
    ...(client.user != null && { requestedBy: client.user }),
    searchEngine: QueryType.AUTO,
  });
  if (!result.hasTracks()) {
    return undefined;
  }
  return result.tracks[0];
}

async function handleAddTrack(
  player: Player,
  queue: GuildQueue | undefined,
  query: string | undefined,
): Promise<QueueResult> {
  if (query == null || query.length === 0) {
    return { success: false, message: "query is required for add" };
  }
  if (queue == null) {
    return {
      success: false,
      message: "No active queue. Use play to start first.",
    };
  }
  const track = await searchFirstTrack(player, query);
  if (track == null) {
    return { success: false, message: "No tracks found" };
  }
  queue.addTrack(track);
  const info = normalizeTrack(track);
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Added to Queue",
      message: `Added: ${info.title}`,
      track: info,
    }),
  );
  return {
    success: true,
    message: `Added to queue: ${info.title}`,
    data: {
      ...info,
      position: queue.tracks.size,
      queueLength: queue.tracks.size,
    },
  };
}

async function handleRemoveTrack(
  queue: GuildQueue | undefined,
  position: number | undefined,
): Promise<QueueResult> {
  if (position === undefined) {
    return { success: false, message: "position is required for remove" };
  }
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  const index = position - 1;
  const tracks = getQueuedTracks(queue);
  if (index < 0 || index >= tracks.length) {
    return { success: false, message: "Invalid position" };
  }
  const track = tracks[index];
  queue.removeTrack(index);
  const info = track == null ? undefined : normalizeTrack(track);
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Removed from Queue",
      message: `Removed: ${info?.title ?? "Unknown"}`,
      track: info,
    }),
  );
  return {
    success: true,
    message: `Removed: ${info?.title ?? "Unknown"}`,
    ...(info != null && { data: info }),
  };
}

function rebuildQueue(queue: GuildQueue, tracks: Track[]): void {
  queue.tracks.clear();
  for (const track of tracks) {
    queue.addTrack(track);
  }
}

async function handleMoveTrack(
  queue: GuildQueue | undefined,
  position: number | undefined,
  targetPosition: number | undefined,
): Promise<QueueResult> {
  if (position === undefined || targetPosition === undefined) {
    return {
      success: false,
      message: "position and targetPosition are required for move",
    };
  }
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  const tracks = getQueuedTracks(queue);
  const fromIndex = position - 1;
  const toIndex = targetPosition - 1;
  if (
    fromIndex < 0 ||
    fromIndex >= tracks.length ||
    toIndex < 0 ||
    toIndex >= tracks.length
  ) {
    return { success: false, message: "Invalid position" };
  }
  const track = tracks[fromIndex];
  if (track == null) {
    return { success: false, message: "Invalid position" };
  }
  tracks.splice(fromIndex, 1);
  tracks.splice(toIndex, 0, track);
  rebuildQueue(queue, tracks);
  const info = normalizeTrack(track);
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Moved Track",
      message: `Moved ${info.title} to ${String(targetPosition)}.`,
      track: info,
    }),
  );
  return {
    success: true,
    message: `Moved ${info.title} to ${String(targetPosition)}`,
    data: { ...info, position: targetPosition },
  };
}

async function handleJumpTrack(
  queue: GuildQueue | undefined,
  position: number | undefined,
): Promise<QueueResult> {
  if (position === undefined) {
    return { success: false, message: "position is required for jump" };
  }
  if (queue?.isPlaying() !== true) {
    return { success: false, message: "Nothing is playing" };
  }
  const tracks = getQueuedTracks(queue);
  const index = position - 1;
  if (index < 0 || index >= tracks.length) {
    return { success: false, message: "Invalid position" };
  }
  const track = tracks[index];
  if (track == null) {
    return { success: false, message: "Invalid position" };
  }
  tracks.splice(index, 1);
  tracks.unshift(track);
  rebuildQueue(queue, tracks);
  queue.node.skip();
  const info = normalizeTrack(track);
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Jumped",
      message: `Jumping to: ${info.title}`,
      track: info,
    }),
  );
  return { success: true, message: `Jumping to: ${info.title}`, data: info };
}

async function handleShuffle(
  queue: GuildQueue | undefined,
): Promise<QueueResult> {
  if (queue == null || queue.tracks.size === 0) {
    return { success: false, message: "No tracks to shuffle" };
  }
  queue.tracks.shuffle();
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Queue Shuffled",
      message: `Shuffled ${String(queue.tracks.size)} queued tracks.`,
    }),
  );
  return { success: true, message: "Queue shuffled" };
}

async function handleClear(
  queue: GuildQueue | undefined,
): Promise<QueueResult> {
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.tracks.clear();
  await sendMusicEmbed(
    buildActionEmbed({ title: "Queue Cleared", message: "Queue cleared." }),
  );
  return { success: true, message: "Queue cleared" };
}

async function dispatchQueueAction(
  player: Player,
  queue: GuildQueue | undefined,
  ctx: {
    action: string;
    query?: string | undefined;
    position?: number | undefined;
    targetPosition?: number | undefined;
  },
): Promise<QueueResult> {
  switch (ctx.action) {
    case "get":
    case "summary":
      return await handleGetQueue(queue);
    case "add":
      return await handleAddTrack(player, queue, ctx.query);
    case "remove":
      return await handleRemoveTrack(queue, ctx.position);
    case "move":
      return await handleMoveTrack(queue, ctx.position, ctx.targetPosition);
    case "jump":
      return await handleJumpTrack(queue, ctx.position);
    case "shuffle":
      return await handleShuffle(queue);
    case "clear":
      return await handleClear(queue);
    default:
      return { success: false, message: `Unknown action: ${ctx.action}` };
  }
}

export const musicQueueTool = createTool({
  id: "music-queue",
  description:
    "Manage music queue: get/summary, add track, remove, move, jump, shuffle, or clear",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum([
        "get",
        "summary",
        "add",
        "remove",
        "move",
        "jump",
        "shuffle",
        "clear",
      ])
      .describe("The action to perform"),
    query: z.string().optional().describe("Song name or URL (for add)"),
    position: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Track position 1-based (for remove, move, jump)"),
    targetPosition: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Destination position 1-based (for move)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      const player = getMusicPlayer();
      const queue = player.queues.get(ctx.guildId) ?? undefined;

      return await dispatchQueueAction(player, queue, ctx);
    } catch (error) {
      logger.error("Failed music queue action", error);
      return { success: false, message: "Failed to perform queue action" };
    }
  },
});

export const queueTools = [musicQueueTool];
