import type { Message, Collection, Snowflake } from "discord.js";

export type ChannelMessage = {
  id: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  content: string;
  createdAt: Date;
};

/** The subset of a Discord message the transcript helpers actually read. */
export type MessageLike = {
  id: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    bot: boolean;
  };
  content: string;
  createdAt: Date;
  createdTimestamp: number;
};

/**
 * The subset of a Discord {@link Message} needed to fetch a transcript. A real
 * `Message` satisfies this structurally; using it (instead of `Message`) keeps
 * the helper trivially testable with a plain fake. `ReadonlyMap` is used so a
 * `Collection` (which extends `Map`) is assignable here.
 */
export type TranscriptSource = {
  id: string;
  channel: {
    messages: {
      fetch: (options: {
        limit: number;
        before: string;
      }) => Promise<ReadonlyMap<string, MessageLike>>;
    };
  };
};

function toChannelMessage(msg: MessageLike): ChannelMessage {
  return {
    id: msg.id,
    authorId: msg.author.id,
    authorName: msg.author.displayName || msg.author.username,
    isBot: msg.author.bot,
    content: msg.content,
    createdAt: msg.createdAt,
  };
}

/**
 * Get recent messages from a channel, excluding the triggering message.
 * Returns messages in chronological order (oldest first).
 */
export async function getRecentChannelMessages(
  message: Message,
  limit = 10,
): Promise<ChannelMessage[]> {
  try {
    // Fetch messages before the current one
    const messages: Collection<Snowflake, Message> =
      await message.channel.messages.fetch({
        limit,
        before: message.id,
      });

    // Convert to our format and reverse to chronological order
    return messages.map((msg) => toChannelMessage(msg)).reverse();
  } catch (error) {
    console.error("Failed to fetch channel messages:", error);
    return [];
  }
}

export type TranscriptOptions = {
  /** Include messages newer than this many ms. */
  windowMs: number;
  /** Hard cap on how many messages to fetch/return. */
  maxMessages: number;
};

/**
 * Fetch a conversation transcript for context, excluding the triggering
 * message. It includes messages within `windowMs`, capped at `maxMessages`.
 *
 * Returns messages in chronological order (oldest first). A single Discord
 * fetch page is 100 messages, so `maxMessages` should stay <= 100 to avoid
 * pagination.
 */
export async function getConversationTranscript(
  message: TranscriptSource,
  options: TranscriptOptions,
): Promise<ChannelMessage[]> {
  const result = await getConversationTranscriptResult(message, options);
  return result.messages;
}

export type TranscriptResult = {
  messages: ChannelMessage[];
  fetchFailed: boolean;
};

export async function getConversationTranscriptResult(
  message: TranscriptSource,
  options: TranscriptOptions,
): Promise<TranscriptResult> {
  const { windowMs, maxMessages } = options;
  try {
    const messages = await message.channel.messages.fetch({
      limit: Math.min(maxMessages, 100),
      before: message.id,
    });

    const newestFirst = [...messages.values()].toSorted(
      (a, b) => b.createdTimestamp - a.createdTimestamp,
    );
    const cutoff = Date.now() - windowMs;

    const kept = newestFirst.filter((msg) => msg.createdTimestamp >= cutoff);

    // Chronological order (oldest first) for prompt readability.
    return {
      messages: kept.map((msg) => toChannelMessage(msg)).reverse(),
      fetchFailed: false,
    };
  } catch (error) {
    console.error("Failed to fetch conversation transcript:", error);
    return { messages: [], fetchFailed: true };
  }
}

/**
 * Render a transcript as plain text lines for prompt injection.
 * The bot's own messages are marked so the model can tell them apart.
 */
export function formatTranscript(messages: ChannelMessage[]): string {
  return messages
    .map((msg) => {
      const name = msg.isBot ? `${msg.authorName} (you)` : msg.authorName;
      return `${name}: ${msg.content}`;
    })
    .join("\n");
}
