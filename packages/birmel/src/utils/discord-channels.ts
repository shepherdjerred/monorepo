import type { Channel, TextBasedChannel } from "discord.js";

/**
 * Narrow a channel to a text-based channel that supports sending messages.
 * Returns null if the channel is not text-based or doesn't support sending.
 */
export function asTextChannel(
  channel: Channel | null | undefined,
): TextBasedChannel | null {
  if (channel == null) {
    return null;
  }
  if (channel.isTextBased()) {
    return channel;
  }
  return null;
}
