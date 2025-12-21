import { getDatabase } from "../client.js";

export type ServerEvent = {
  id: number;
  guildId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
};

export type CreateEventInput = {
  guildId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  actorId?: string;
};

export function recordEvent(input: CreateEventInput): number {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO server_events (guild_id, event_type, event_data, actor_id)
     VALUES (?, ?, ?, ?)`,
    [
      input.guildId,
      input.eventType,
      JSON.stringify(input.eventData),
      input.actorId ?? null,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getRecentEvents(
  guildId: string,
  limit = 50,
): ServerEvent[] {
  const db = getDatabase();
  const results = db.query<
    {
      id: number;
      guild_id: string;
      event_type: string;
      event_data: string;
      actor_id: string | null;
      created_at: string;
    },
    [string, number]
  >(
    `SELECT * FROM server_events
     WHERE guild_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(guildId, limit);

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    eventType: row.event_type,
    eventData: JSON.parse(row.event_data) as Record<string, unknown>,
    actorId: row.actor_id,
    createdAt: row.created_at,
  }));
}

export function getEventsSince(
  guildId: string,
  since: Date,
): ServerEvent[] {
  const db = getDatabase();
  const results = db.query<
    {
      id: number;
      guild_id: string;
      event_type: string;
      event_data: string;
      actor_id: string | null;
      created_at: string;
    },
    [string, string]
  >(
    `SELECT * FROM server_events
     WHERE guild_id = ? AND created_at >= ?
     ORDER BY created_at DESC`,
  ).all(guildId, since.toISOString());

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    eventType: row.event_type,
    eventData: JSON.parse(row.event_data) as Record<string, unknown>,
    actorId: row.actor_id,
    createdAt: row.created_at,
  }));
}

export function clearOldEvents(daysToKeep = 90): number {
  const db = getDatabase();
  const result = db.run(
    `DELETE FROM server_events
     WHERE created_at < datetime('now', '-' || ? || ' days')`,
    [daysToKeep],
  );
  return result.changes;
}
