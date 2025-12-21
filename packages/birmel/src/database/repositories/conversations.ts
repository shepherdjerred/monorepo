import { getDatabase } from "../client.js";

export type ConversationMessage = {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  source: "text" | "voice";
  createdAt: string;
  metadata: string | null;
};

export type CreateMessageInput = {
  guildId: string;
  channelId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  source?: "text" | "voice";
  metadata?: Record<string, unknown>;
};

export function addMessage(input: CreateMessageInput): number {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO conversations (guild_id, channel_id, user_id, role, content, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.guildId,
      input.channelId,
      input.userId,
      input.role,
      input.content,
      input.source ?? "text",
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getRecentMessages(
  guildId: string,
  userId: string,
  limit = 10,
): ConversationMessage[] {
  const db = getDatabase();
  const results = db.query<
    {
      id: number;
      guild_id: string;
      channel_id: string;
      user_id: string;
      role: "user" | "assistant" | "system";
      content: string;
      source: "text" | "voice";
      created_at: string;
      metadata: string | null;
    },
    [string, string, number]
  >(
    `SELECT * FROM conversations
     WHERE guild_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(guildId, userId, limit);

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    metadata: row.metadata,
  }));
}

export function getChannelMessages(
  channelId: string,
  limit = 50,
): ConversationMessage[] {
  const db = getDatabase();
  const results = db.query<
    {
      id: number;
      guild_id: string;
      channel_id: string;
      user_id: string;
      role: "user" | "assistant" | "system";
      content: string;
      source: "text" | "voice";
      created_at: string;
      metadata: string | null;
    },
    [string, number]
  >(
    `SELECT * FROM conversations
     WHERE channel_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(channelId, limit);

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    metadata: row.metadata,
  }));
}

export function clearOldMessages(daysToKeep = 30): number {
  const db = getDatabase();
  const result = db.run(
    `DELETE FROM conversations
     WHERE created_at < datetime('now', '-' || ? || ' days')`,
    [daysToKeep],
  );
  return result.changes;
}
