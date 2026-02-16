import type { Channel, Message, MessageCreateOptions, MessagePayload } from "discord.js";

/**
 * Minimal interface for text channels that support sending messages
 */
export type SendableChannel = {
  send(content: string | MessagePayload | MessageCreateOptions): Promise<Message>;
};

/**
 * Check if a channel is text-based and return it with proper typing
 *
 * This is one of the rare cases where we use a type assertion, as Discord.js
 * channel types are complex and after checking isTextBased(), we know it has send()
 *
 * @param channel Channel to check
 * @returns SendableChannel if channel is text-based, undefined otherwise
 */
export function asTextChannel(channel: Channel): SendableChannel | undefined {
  if (!channel.isTextBased()) {
    return undefined;
  }

  // Type assertion needed: Discord.js's isTextBased() runtime check guarantees send() method exists
  // but TypeScript's type system can't express this relationship
  // eslint-disable-next-line custom-rules/no-type-assertions -- Type assertion is safe here because we checked the type above
  return channel as unknown as SendableChannel;
}
