import { QueryType, QueueRepeatMode } from "discord-player";
import type { VoiceChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { getMusicPlayer } from "../../../music/index.js";
import { logger } from "../../../utils/index.js";

type PlaybackResult = {
  success: boolean;
  message: string;
  data?: {
    title: string;
    duration: string;
    url: string;
    progress?: string;
  };
};

export async function handlePlay(
  guildId: string,
  channelId: string | undefined,
  voiceChannelId: string | undefined,
  query: string | undefined,
): Promise<PlaybackResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    voiceChannelId == null ||
    voiceChannelId.length === 0 ||
    query == null ||
    query.length === 0
  ) {
    return {
      success: false,
      message: "channelId, voiceChannelId, and query are required for play",
    };
  }
  const player = getMusicPlayer();
  const client = getDiscordClient();
  const channel = await client.channels.fetch(channelId);
  const voiceChannel = await client.channels.fetch(voiceChannelId);
  if (voiceChannel?.isVoiceBased() !== true) {
    return { success: false, message: "Invalid voice channel" };
  }
  const searchResult = await player.search(query, {
    ...(client.user != null && { requestedBy: client.user }),
    searchEngine: QueryType.AUTO,
  });
  if (!searchResult.hasTracks()) {
    return { success: false, message: "No results found" };
  }
  const result = await player.play(voiceChannel as VoiceChannel, searchResult, {
    nodeOptions: {
      metadata: channel,
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 60_000,
      leaveOnEnd: false,
      leaveOnEndCooldown: 60_000,
    },
  });
  const track = result.track;
  logger.info("Music playback started", { guildId, track: track.title });
  return {
    success: true,
    message: `Playing: ${track.title}`,
    data: { title: track.title, duration: track.duration, url: track.url },
  };
}

export function handlePause(guildId: string): PlaybackResult {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue?.isPlaying() !== true) {
    return { success: false, message: "Nothing is playing" };
  }
  queue.node.pause();
  return { success: true, message: "Paused playback" };
}

export function handleResume(guildId: string): PlaybackResult {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.node.resume();
  return { success: true, message: "Resumed playback" };
}

export function handleSkip(guildId: string): PlaybackResult {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
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

export function handleStop(guildId: string): PlaybackResult {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.delete();
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
  return {
    success: true,
    message: `Seeked to ${String(mins)}:${String(secs).padStart(2, "0")}`,
  };
}

export function handleSetVolume(
  guildId: string,
  volume: number | undefined,
): PlaybackResult {
  if (volume === undefined) {
    return { success: false, message: "volume is required for set-volume" };
  }
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
  if (queue == null) {
    return { success: false, message: "No active queue" };
  }
  queue.node.setVolume(volume);
  return { success: true, message: `Volume set to ${String(volume)}%` };
}

export function handleSetLoop(
  guildId: string,
  loopMode: "off" | "track" | "queue" | "autoplay" | undefined,
): PlaybackResult {
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
  return { success: true, message: `Loop mode set to ${loopMode}` };
}

export function handleNowPlaying(guildId: string): PlaybackResult {
  const player = getMusicPlayer();
  const queue = player.queues.get(guildId);
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
