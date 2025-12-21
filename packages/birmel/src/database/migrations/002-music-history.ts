import type { Database } from "bun:sqlite";

export const version = 2;

export function up(db: Database): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
  db.exec(`
    -- Music history - Track played songs
    CREATE TABLE IF NOT EXISTS music_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      track_title TEXT NOT NULL,
      track_url TEXT NOT NULL,
      track_duration INTEGER,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_music_history_guild ON music_history(guild_id, played_at);
  `);
}

export function down(db: Database): void {
  db.run("DROP TABLE IF EXISTS music_history");
}
