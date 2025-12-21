import { getDatabase } from "../client.js";

export type MusicHistoryEntry = {
  id: number;
  guildId: string;
  channelId: string;
  requestedBy: string;
  trackTitle: string;
  trackUrl: string;
  trackDuration: number | null;
  playedAt: string;
};

export type CreateMusicHistoryInput = {
  guildId: string;
  channelId: string;
  requestedBy: string;
  trackTitle: string;
  trackUrl: string;
  trackDuration?: number;
};

export function recordTrackPlay(input: CreateMusicHistoryInput): number {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url, track_duration)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.guildId,
      input.channelId,
      input.requestedBy,
      input.trackTitle,
      input.trackUrl,
      input.trackDuration ?? null,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getRecentTracks(
  guildId: string,
  limit = 20,
): MusicHistoryEntry[] {
  const db = getDatabase();
  const results = db
    .query<
      {
        id: number;
        guild_id: string;
        channel_id: string;
        requested_by: string;
        track_title: string;
        track_url: string;
        track_duration: number | null;
        played_at: string;
      },
      [string, number]
    >(
      `SELECT * FROM music_history
       WHERE guild_id = ?
       ORDER BY played_at DESC
       LIMIT ?`,
    )
    .all(guildId, limit);

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    requestedBy: row.requested_by,
    trackTitle: row.track_title,
    trackUrl: row.track_url,
    trackDuration: row.track_duration,
    playedAt: row.played_at,
  }));
}

export function getTracksByUser(
  guildId: string,
  userId: string,
  limit = 20,
): MusicHistoryEntry[] {
  const db = getDatabase();
  const results = db
    .query<
      {
        id: number;
        guild_id: string;
        channel_id: string;
        requested_by: string;
        track_title: string;
        track_url: string;
        track_duration: number | null;
        played_at: string;
      },
      [string, string, number]
    >(
      `SELECT * FROM music_history
       WHERE guild_id = ? AND requested_by = ?
       ORDER BY played_at DESC
       LIMIT ?`,
    )
    .all(guildId, userId, limit);

  return results.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    requestedBy: row.requested_by,
    trackTitle: row.track_title,
    trackUrl: row.track_url,
    trackDuration: row.track_duration,
    playedAt: row.played_at,
  }));
}

export function getMostPlayedTracks(
  guildId: string,
  limit = 10,
): { trackTitle: string; trackUrl: string; playCount: number }[] {
  const db = getDatabase();
  const results = db
    .query<
      { track_title: string; track_url: string; play_count: number },
      [string, number]
    >(
      `SELECT track_title, track_url, COUNT(*) as play_count
       FROM music_history
       WHERE guild_id = ?
       GROUP BY track_url
       ORDER BY play_count DESC
       LIMIT ?`,
    )
    .all(guildId, limit);

  return results.map((row) => ({
    trackTitle: row.track_title,
    trackUrl: row.track_url,
    playCount: row.play_count,
  }));
}

export function clearOldHistory(daysToKeep = 90): number {
  const db = getDatabase();
  const result = db.run(
    `DELETE FROM music_history
     WHERE played_at < datetime('now', '-' || ? || ' days')`,
    [daysToKeep],
  );
  return result.changes;
}
