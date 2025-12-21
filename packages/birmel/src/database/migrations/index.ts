import type { Database } from "bun:sqlite";
import { logger } from "../../utils/index.js";

type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial",
    up: (db) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
      db.exec(`
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

        CREATE INDEX IF NOT EXISTS idx_conversations_guild_user
          ON conversations(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_created
          ON conversations(created_at);

        CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          preference_key TEXT NOT NULL,
          preference_value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, guild_id, preference_key)
        );

        CREATE TABLE IF NOT EXISTS server_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_data TEXT NOT NULL,
          actor_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_server_events_guild
          ON server_events(guild_id, created_at);
      `);
    },
  },
  {
    version: 2,
    name: "music_history",
    up: (db) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
      db.exec(`
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

        CREATE INDEX IF NOT EXISTS idx_music_history_guild
          ON music_history(guild_id, played_at);
      `);
    },
  },
  {
    version: 3,
    name: "daily_post_config",
    up: (db) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
      db.exec(`
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
    },
  },
];

export function runMigrations(db: Database): void {
  // Create migrations table if not exists
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exec is needed for multi-statement SQL
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Get current version
  const result = db.query<{ version: number }, []>(
    "SELECT MAX(version) as version FROM migrations",
  ).get();
  const currentVersion = result?.version ?? 0;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      logger.info("Running migration", {
        version: migration.version,
        name: migration.name,
      });

      db.transaction(() => {
        migration.up(db);
        db.run(
          "INSERT INTO migrations (version, name) VALUES (?, ?)",
          [migration.version, migration.name],
        );
      })();
    }
  }
}
