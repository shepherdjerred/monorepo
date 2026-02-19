import type {
  Channel,
  Message,
  MessageCreateOptions,
  MessagePayload,
} from "discord.js";

/**
 * Minimal interface for text channels that support sending messages
 */
export type SendableChannel = {
  send: (
    content: string | MessagePayload | MessageCreateOptions,
  ) => Promise<Message>;
};

/**
 * Check if a channel is text-based and return it with proper typing
 *
 * Discord.js's isTextBased() is a type guard that narrows to TextBasedChannel,
 * which includes the send() method we need.
 *
 * @param channel Channel to check
 * @returns SendableChannel if channel is text-based, undefined otherwise
 */
export function asTextChannel(channel: Channel): SendableChannel | undefined {
  if (!channel.isTextBased()) {
    return undefined;
  }

  // isTextBased() narrows to TextBasedChannel which has send()
  return channel;
}
