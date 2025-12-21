import type { Database } from "bun:sqlite";

export const version = 1;

export function up(db: Database): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
  db.exec(`
    -- Conversations - Chat history for memory/context
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_guild_user ON conversations(guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

    -- User preferences - Per-user settings
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      preference_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, guild_id, preference_key)
    );

    -- Server events - Track notable events for daily summaries
    CREATE TABLE IF NOT EXISTS server_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      actor_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_server_events_guild ON server_events(guild_id, created_at);

    -- Daily post config - Per-guild daily post settings
    CREATE TABLE IF NOT EXISTS daily_post_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      channel_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      post_time TEXT DEFAULT '09:00',
      timezone TEXT DEFAULT 'UTC',
      last_post_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function down(db: Database): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
  db.exec(`
    DROP TABLE IF EXISTS daily_post_config;
    DROP TABLE IF EXISTS server_events;
    DROP TABLE IF EXISTS user_preferences;
    DROP TABLE IF EXISTS conversations;
  `);
}
