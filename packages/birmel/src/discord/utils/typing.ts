import type { Message, TextChannel, DMChannel, NewsChannel } from "discord.js";

type TypingChannel = TextChannel | DMChannel | NewsChannel;

/**
 * Execute an async function while showing a typing indicator in the channel.
 * The typing indicator refreshes every 9 seconds (Discord indicator lasts 10s).
 */
export async function withTyping<T>(
  message: Message,
  asyncFn: () => Promise<T>
): Promise<T> {
  const channel = message.channel;

  // Check if channel supports typing
  if (!isTypingChannel(channel)) {
    return asyncFn();
  }

  // Start typing immediately
  await channel.sendTyping();

  // Refresh typing every 9 seconds (indicator lasts 10s)
  const typingInterval = setInterval(async () => {
    try {
      await channel.sendTyping();
    } catch {
      // Ignore errors from typing - channel might be gone
    }
  }, 9000);

  try {
    return await asyncFn();
  } finally {
    clearInterval(typingInterval);
  }
}

function isTypingChannel(channel: unknown): channel is TypingChannel {
  return (
    channel !== null &&
    typeof channel === "object" &&
    "sendTyping" in channel &&
    typeof (channel as TypingChannel).sendTyping === "function"
  );
}
