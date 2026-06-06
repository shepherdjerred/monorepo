import {
  QueryType,
  QueueRepeatMode,
  type GuildQueue,
  type Track,
} from "discord-player";
import { ChannelType } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { getMusicPlayer } from "@shepherdjerred/birmel/music/player.ts";
import {
  buildActionEmbed,
  buildHelpEmbed,
  buildNowPlayingEmbed,
  buildRecentTracksEmbed,
} from "@shepherdjerred/birmel/music/embeds.ts";
import {
  normalizeTrack,
  type MusicTrackInfo,
} from "@shepherdjerred/birmel/music/metadata.ts";
import { sendMusicEmbed } from "@shepherdjerred/birmel/music/responses.ts";
import { getRecentTracks } from "@shepherdjerred/birmel/database/repositories/music-history.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

export type PlaybackResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

function getDefaultTextChannelId(
  channelId: string | undefined,
): string | undefined {
  if (channelId != null && channelId.length > 0) {
    return channelId;
  }
  return getRequestContext()?.sourceChannelId;
}

function getDefaultVoiceChannelId(
  voiceChannelId: string | undefined,
): string | undefined {
  if (voiceChannelId != null && voiceChannelId.length > 0) {
    return voiceChannelId;
  }
  return getRequestContext()?.voiceChannelId;
}

async function searchFirstTrack(query: string): Promise<Track | undefined> {
  const player = getMusicPlayer();
  const client = getDiscordClient();
  const searchResult = await player.search(query, {
    ...(client.user != null && { requestedBy: client.user }),
    searchEngine: QueryType.AUTO,
  });
  if (!searchResult.hasTracks()) {
    return undefined;
  }
  return searchResult.tracks[0];
}

async function addQueryToQueue(
  queue: GuildQueue,
  query: string,
): Promise<MusicTrackInfo | undefined> {
  const track = await searchFirstTrack(query);
  if (track == null) {
    return undefined;
  }
  queue.addTrack(track);
  return normalizeTrack(track);
}

async function sendAction(
  title: string,
  message: string,
  track?: MusicTrackInfo,
): Promise<void> {
  await sendMusicEmbed(buildActionEmbed({ title, message, track }));
}

export async function handlePlay(
  guildId: string,
  channelId: string | undefined,
  voiceChannelId: string | undefined,
  query: string | undefined,
): Promise<PlaybackResult> {
  const resolvedChannelId = getDefaultTextChannelId(channelId);
  const resolvedVoiceChannelId = getDefaultVoiceChannelId(voiceChannelId);
  if (resolvedChannelId == null || resolvedChannelId.length === 0) {
    return { success: false, message: "No text channel is available for play" };
  }
  if (resolvedVoiceChannelId == null || resolvedVoiceChannelId.length === 0) {
    return {
      success: false,
      message: "Join a voice channel first, then ask me to play something.",
    };
  }
  if (query == null || query.length === 0) {
    return { success: false, message: "query is required for play" };
  }

  const player = getMusicPlayer();
  const client = getDiscordClient();
  const channel = await client.channels.fetch(resolvedChannelId);
  const voiceChannel = await client.channels.fetch(resolvedVoiceChannelId);
  if (voiceChannel?.isVoiceBased() !== true) {
    return { success: false, message: "Invalid voice channel" };
  }
  if (voiceChannel.type !== ChannelType.GuildVoice) {
    return { success: false, message: "Channel is not a guild voice channel" };
  }

  const searchResult = await player.search(query, {
    ...(client.user != null && { requestedBy: client.user }),
    searchEngine: QueryType.AUTO,
  });
  if (!searchResult.hasTracks()) {
    return { success: false, message: "No results found" };
  }

  const result = await player.play(voiceChannel, searchResult, {
    nodeOptions: {
      ...(channel != null && { metadata: channel }),
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 60_000,
      leaveOnEnd: false,
      leaveOnEndCooldown: 60_000,
    },
  });
  const track = result.track;
  const info = normalizeTrack(track);
  logger.info("Music playback started", { guildId, track: info.title });
  return {
    success: true,
    message: `Playing: ${info.title}`,
    data: {
      ...info,
      queueLength: player.queues.get(guildId)?.tracks.size ?? 0,
    },
  };
}

export async function handlePause(guildId: string): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true) {
    return { success: false, message: "Nothing is playing" };
  }
  queue.node.pause();
  await sendAction("Paused", "Paused playback.");
  return { success: true, message: "Paused playback" };
}

export async function handleResume(guildId: string): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.node.resume();
  await sendAction("Resumed", "Resumed playback.");
  return { success: true, message: "Resumed playback" };
}

export async function handleSkip(guildId: string): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true) {
    return { success: false, message: "Nothing is playing" };
  }
  const track =
    queue.currentTrack == null ? undefined : normalizeTrack(queue.currentTrack);
  queue.node.skip();
  await sendAction("Skipped", `Skipped: ${track?.title ?? "Unknown"}`, track);
  return {
    success: true,
    message: `Skipped: ${track?.title ?? "Unknown"}`,
    ...(track != null && { data: track }),
  };
}

export async function handleStop(guildId: string): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.delete();
  await sendAction("Stopped", "Stopped playback and cleared the queue.");
  return { success: true, message: "Stopped playback and cleared queue" };
}

export async function handleSeek(
  guildId: string,
  seconds: number | undefined,
): Promise<PlaybackResult> {
  if (seconds === undefined) {
    return { success: false, message: "seconds is required for seek" };
  }
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true) {
    return { success: false, message: "Nothing is playing" };
  }
  const success = await queue.node.seek(seconds * 1000);
  if (!success) {
    return { success: false, message: "Failed to seek" };
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const message = `Seeked to ${String(mins)}:${String(secs).padStart(2, "0")}`;
  await sendAction("Seeked", message);
  return { success: true, message };
}

export async function handleSetVolume(
  guildId: string,
  volume: number | undefined,
): Promise<PlaybackResult> {
  if (volume === undefined) {
    return { success: false, message: "volume is required for set-volume" };
  }
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.node.setVolume(volume);
  await sendAction("Volume", `Volume set to ${String(volume)}%.`);
  return { success: true, message: `Volume set to ${String(volume)}%` };
}

export async function handleSetLoop(
  guildId: string,
  loopMode: "off" | "track" | "queue" | "autoplay" | undefined,
): Promise<PlaybackResult> {
  if (loopMode == null || loopMode.length === 0) {
    return { success: false, message: "loopMode is required for set-loop" };
  }
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  const modeMap = {
    off: QueueRepeatMode.OFF,
    track: QueueRepeatMode.TRACK,
    queue: QueueRepeatMode.QUEUE,
    autoplay: QueueRepeatMode.AUTOPLAY,
  };
  queue.setRepeatMode(modeMap[loopMode]);
  await sendAction("Loop Mode", `Loop mode set to ${loopMode}.`);
  return { success: true, message: `Loop mode set to ${loopMode}` };
}

export async function handleNowPlaying(
  guildId: string,
): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true || queue.currentTrack == null) {
    return { success: false, message: "Nothing is playing" };
  }
  const track = normalizeTrack(queue.currentTrack);
  const progress = queue.node.createProgressBar();
  await sendMusicEmbed(buildNowPlayingEmbed(track, progress ?? undefined));
  return {
    success: true,
    message: `Now playing: ${track.title}`,
    data: { ...track, progress: progress ?? "" },
  };
}

export async function handleReplayCurrent(
  guildId: string,
): Promise<PlaybackResult> {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true || queue.currentTrack == null) {
    return { success: false, message: "Nothing is playing" };
  }
  const success = await queue.node.seek(0);
  if (!success) {
    return { success: false, message: "Failed to replay current track" };
  }
  const track = normalizeTrack(queue.currentTrack);
  await sendAction("Replaying", `Restarted: ${track.title}`, track);
  return { success: true, message: `Replaying: ${track.title}`, data: track };
}

export async function handleReplayRecent(
  guildId: string,
  channelId: string | undefined,
  voiceChannelId: string | undefined,
  position = 1,
): Promise<PlaybackResult> {
  if (position < 1) {
    return { success: false, message: "recent position must be 1 or greater" };
  }
  const recentTracks = await getRecentTracks(guildId, position);
  const recent = recentTracks[position - 1];
  if (recent == null) {
    return {
      success: false,
      message: "No recent track found at that position",
    };
  }
  return await handlePlay(guildId, channelId, voiceChannelId, recent.trackUrl);
}

export async function handleRecentTracks(
  guildId: string,
  limit = 10,
): Promise<PlaybackResult> {
  const recentTracks = await getRecentTracks(guildId, limit);
  const tracks = recentTracks.map((track) => ({
    title: track.trackName,
    duration: "unknown",
    url: track.trackUrl,
    requestedBy: track.userId,
  }));
  await sendMusicEmbed(buildRecentTracksEmbed(tracks));
  return {
    success: true,
    message: `Found ${String(tracks.length)} recent tracks`,
    data: { tracks },
  };
}

export async function handleMusicHelp(): Promise<PlaybackResult> {
  await sendMusicEmbed(buildHelpEmbed());
  return {
    success: true,
    message:
      "I can play music, manage the queue, replay recent tracks, and manage temporary playlists.",
  };
}

export async function playTrackInfos(
  guildId: string,
  channelId: string | undefined,
  voiceChannelId: string | undefined,
  tracks: MusicTrackInfo[],
): Promise<PlaybackResult> {
  const firstTrack = tracks[0];
  if (firstTrack == null) {
    return { success: false, message: "No tracks to play" };
  }

  const playResult = await handlePlay(
    guildId,
    channelId,
    voiceChannelId,
    firstTrack.url,
  );
  if (!playResult.success) {
    return playResult;
  }

  const queue = getMusicPlayer().queues.get(guildId);
  if (queue == null) {
    return playResult;
  }

  for (const track of tracks.slice(1)) {
    await addQueryToQueue(
      queue,
      track.url.length > 0 ? track.url : track.title,
    );
  }

  return {
    success: true,
    message: `Started playlist with ${String(tracks.length)} tracks`,
    data: { tracks, queueLength: queue.tracks.size },
  };
}
