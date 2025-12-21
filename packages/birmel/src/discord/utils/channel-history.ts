import type { Message, Collection, Snowflake } from "discord.js";

export interface ChannelMessage {
  id: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  content: string;
  createdAt: Date;
}

/**
 * Get recent messages from a channel, excluding the triggering message.
 * Returns messages in chronological order (oldest first).
 */
export async function getRecentChannelMessages(
  message: Message,
  limit: number = 10
): Promise<ChannelMessage[]> {
  try {
    // Fetch messages before the current one
    const messages: Collection<Snowflake, Message> =
      await message.channel.messages.fetch({
        limit,
        before: message.id,
      });

    // Convert to our format and reverse to chronological order
    return messages
      .map((msg) => ({
        id: msg.id,
        authorId: msg.author.id,
        authorName: msg.author.displayName || msg.author.username,
        isBot: msg.author.bot,
        content: msg.content,
        createdAt: msg.createdAt,
      }))
      .reverse();
  } catch (error) {
    console.error("Failed to fetch channel messages:", error);
    return [];
  }
}

/**
 * Format messages for the classifier agent.
 * Returns a string representation of recent channel activity.
 */
export function formatMessagesForClassifier(
  messages: ChannelMessage[],
  newMessage: Message
): string {
  const lines: string[] = [];

  lines.push("=== Recent Channel Messages ===");
  for (const msg of messages) {
    const botTag = msg.isBot ? " [BOT]" : "";
    lines.push(`${msg.authorName}${botTag}: ${msg.content}`);
  }

  lines.push("");
  lines.push("=== New Message to Classify ===");
  const newAuthorName =
    newMessage.author.displayName || newMessage.author.username;
  lines.push(`${newAuthorName}: ${newMessage.content}`);

  return lines.join("\n");
}
