import { z } from "zod";

/** A logical Streambot channel, distinct from a Discord channel snowflake. */
export const PlaybackChannelNumberSchema = z
  .number()
  .int()
  .positive()
  .brand<"PlaybackChannelNumber">();
export type PlaybackChannelNumber = z.infer<typeof PlaybackChannelNumberSchema>;
export const AUDIO_CHANNEL = PlaybackChannelNumberSchema.parse(1);
export function playbackTransport(
  channel: PlaybackChannelNumber,
): "music" | "video" {
  return channel === 1 ? "music" : "video";
}
export function playbackChannelLabel(channel: PlaybackChannelNumber): string {
  return `channel ${String(channel)} · ${channel === 1 ? "Audio" : "Video"}`;
}
export const NUMBERED_CHANNEL_HINT =
  "Streambot channels are playback slots in your Discord voice channel. Channel 1 plays audio through the mic; select channel 2 or higher for Go Live video with `/stream select channel:2`. Channels 1 and 2 share one userbot.";
