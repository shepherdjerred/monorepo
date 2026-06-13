import { QueryType } from "discord-player";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { getMusicPlayer } from "@shepherdjerred/birmel/music/player.ts";
import {
  buildActionEmbed,
  buildPlaylistEmbed,
  buildPlaylistListEmbed,
} from "@shepherdjerred/birmel/music/embeds.ts";
import {
  normalizeTrack,
  type MusicTrackInfo,
} from "@shepherdjerred/birmel/music/metadata.ts";
import {
  addTrackToPlaylist,
  clearPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistTrack,
  removeTrackFromPlaylist,
  renamePlaylist,
  replacePlaylistTracks,
  shuffledTracks,
} from "@shepherdjerred/birmel/music/playlists.ts";
import { sendMusicEmbed } from "@shepherdjerred/birmel/music/responses.ts";
import { playTrackInfos } from "./playback-actions.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

type PlaylistToolResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

async function searchTrack(query: string) {
  const player = getMusicPlayer();
  const client = getDiscordClient();
  const searchResult = await player.search(query, {
    ...(client.user != null && { requestedBy: client.user }),
    searchEngine: QueryType.AUTO,
  });
  if (!searchResult.hasTracks()) {
    return;
  }
  return searchResult.tracks[0];
}

function ensureName(name: string | undefined): string | undefined {
  if (name == null || name.trim().length === 0) {
    return undefined;
  }
  return name.trim();
}

function playlistData(
  name: string,
  tracks: unknown[],
): Record<string, unknown> {
  return { playlistName: name, tracks, trackCount: tracks.length };
}

async function sendPlaylist(
  name: string,
  tracks: MusicTrackInfo[],
): Promise<void> {
  await sendMusicEmbed(buildPlaylistEmbed({ name, tracks }));
}

async function handleCreate(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const result = createPlaylist(guildId, playlistName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Created playlist: ${result.value.name}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleList(guildId: string): Promise<PlaylistToolResult> {
  const playlists = listPlaylists(guildId);
  await sendMusicEmbed(buildPlaylistListEmbed(playlists));
  return {
    success: true,
    message: `Found ${String(playlists.length)} playlists`,
    data: { playlists },
  };
}

async function handleShow(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const result = getPlaylist(guildId, playlistName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Playlist ${result.value.name} has ${String(result.value.tracks.length)} tracks`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleDelete(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const result = deletePlaylist(guildId, playlistName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Playlist Deleted",
      message: `Deleted playlist: ${result.value.name}`,
    }),
  );
  return { success: true, message: `Deleted playlist: ${result.value.name}` };
}

async function handleRename(
  guildId: string,
  name: string | undefined,
  newName: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  const targetName = ensureName(newName);
  if (playlistName == null || targetName == null) {
    return { success: false, message: "playlistName and newName are required" };
  }
  const result = renamePlaylist(guildId, playlistName, targetName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Renamed playlist to: ${result.value.name}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleAddQuery(
  guildId: string,
  name: string | undefined,
  query: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null || query == null || query.length === 0) {
    return { success: false, message: "playlistName and query are required" };
  }
  const track = await searchTrack(query);
  if (track == null) {
    return { success: false, message: "No tracks found" };
  }
  const trackInfo = normalizeTrack(track);
  const result = addTrackToPlaylist(guildId, playlistName, trackInfo);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Added to playlist: ${trackInfo.title}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleAddCurrent(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const queue = getMusicPlayer().queues.get(guildId);
  if (queue?.currentTrack == null) {
    return { success: false, message: "No current track to add" };
  }
  const track = normalizeTrack(queue.currentTrack);
  const result = addTrackToPlaylist(guildId, playlistName, track);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Added current track to playlist: ${track.title}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleSaveQueue(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const queue = getMusicPlayer().queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  const tracks = [
    ...(queue.currentTrack == null ? [] : [normalizeTrack(queue.currentTrack)]),
    ...queue.tracks.toArray().map((track) => normalizeTrack(track)),
  ];
  if (tracks.length === 0) {
    return { success: false, message: "Queue is empty" };
  }

  const existing = getPlaylist(guildId, playlistName);
  if (!existing.ok) {
    const created = createPlaylist(guildId, playlistName);
    if (!created.ok) {
      return { success: false, message: created.message };
    }
  }
  const result = replacePlaylistTracks(guildId, playlistName, tracks);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Saved queue to playlist: ${result.value.name}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleRemove(
  guildId: string,
  name: string | undefined,
  position: number | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null || position === undefined) {
    return {
      success: false,
      message: "playlistName and position are required",
    };
  }
  const result = removeTrackFromPlaylist(guildId, playlistName, position);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Removed position ${String(position)} from playlist`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleMove(
  guildId: string,
  name: string | undefined,
  position: number | undefined,
  targetPosition: number | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (
    playlistName == null ||
    position === undefined ||
    targetPosition === undefined
  ) {
    return {
      success: false,
      message: "playlistName, position, and targetPosition are required",
    };
  }
  const result = movePlaylistTrack(
    guildId,
    playlistName,
    position,
    targetPosition,
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Moved playlist track to ${String(targetPosition)}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handleClear(
  guildId: string,
  name: string | undefined,
): Promise<PlaylistToolResult> {
  const playlistName = ensureName(name);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const result = clearPlaylist(guildId, playlistName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  await sendPlaylist(result.value.name, result.value.tracks);
  return {
    success: true,
    message: `Cleared playlist: ${result.value.name}`,
    data: playlistData(result.value.name, result.value.tracks),
  };
}

async function handlePlayPlaylist(ctx: {
  guildId: string;
  playlistName?: string | undefined;
  channelId?: string | undefined;
  voiceChannelId?: string | undefined;
  shuffle?: boolean | undefined;
}): Promise<PlaylistToolResult> {
  const playlistName = ensureName(ctx.playlistName);
  if (playlistName == null) {
    return { success: false, message: "playlistName is required" };
  }
  const result = getPlaylist(ctx.guildId, playlistName);
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  const tracks =
    ctx.shuffle === true
      ? shuffledTracks(result.value.tracks)
      : result.value.tracks;
  const playResult = await playTrackInfos(
    ctx.guildId,
    ctx.channelId,
    ctx.voiceChannelId,
    tracks,
  );
  if (!playResult.success) {
    return playResult;
  }
  await sendMusicEmbed(
    buildActionEmbed({
      title: "Playing Playlist",
      message: `Started ${result.value.name}${ctx.shuffle === true ? " shuffled" : ""}.`,
      track: tracks[0],
    }),
  );
  return {
    success: true,
    message: `Playing playlist: ${result.value.name}`,
    data: playlistData(result.value.name, tracks),
  };
}

export const musicPlaylistTool = createTool({
  id: "music-playlist",
  description:
    "Manage per-guild in-memory music playlists: create, delete, rename, list, show, add, add-current, save-queue, remove, move, play, or clear",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum([
        "create",
        "delete",
        "rename",
        "list",
        "show",
        "add",
        "add-current",
        "save-queue",
        "remove",
        "move",
        "play",
        "clear",
      ])
      .describe("The playlist action"),
    playlistName: z.string().optional().describe("Playlist name"),
    newName: z.string().optional().describe("New playlist name for rename"),
    query: z.string().optional().describe("Song name or URL for add"),
    position: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Playlist position for remove or move"),
    targetPosition: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Destination playlist position for move"),
    channelId: z.string().optional().describe("Text channel ID for playback"),
    voiceChannelId: z
      .string()
      .optional()
      .describe("Voice channel ID for playback"),
    shuffle: z.boolean().optional().describe("Shuffle before playing playlist"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "create":
          return await handleCreate(ctx.guildId, ctx.playlistName);
        case "delete":
          return await handleDelete(ctx.guildId, ctx.playlistName);
        case "rename":
          return await handleRename(ctx.guildId, ctx.playlistName, ctx.newName);
        case "list":
          return await handleList(ctx.guildId);
        case "show":
          return await handleShow(ctx.guildId, ctx.playlistName);
        case "add":
          return await handleAddQuery(ctx.guildId, ctx.playlistName, ctx.query);
        case "add-current":
          return await handleAddCurrent(ctx.guildId, ctx.playlistName);
        case "save-queue":
          return await handleSaveQueue(ctx.guildId, ctx.playlistName);
        case "remove":
          return await handleRemove(
            ctx.guildId,
            ctx.playlistName,
            ctx.position,
          );
        case "move":
          return await handleMove(
            ctx.guildId,
            ctx.playlistName,
            ctx.position,
            ctx.targetPosition,
          );
        case "play":
          return await handlePlayPlaylist(ctx);
        case "clear":
          return await handleClear(ctx.guildId, ctx.playlistName);
      }
    } catch (error) {
      logger.error("Failed music playlist action", error);
      return { success: false, message: "Failed to perform playlist action" };
    }
  },
});

export const playlistTools = [musicPlaylistTool];
