import type { Database } from "bun:sqlite";
import { z } from "zod";
import { SourceSchema } from "@shepherdjerred/streambot/sources/source.ts";
import { HistoryProviderSchema } from "./provider.ts";

const RunRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: HistoryProviderSchema,
  source_json: z.string(),
  thumbnail_url: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  guild_id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
  outcome: z.string().nullable(),
  created_at: z.number().nullable(),
});

export function browseRuns(
  database: Database,
  input: {
    userId: string;
    guildId: string;
    visibility: "mine" | "server";
    query: string;
    provider: string;
    offset: number;
  },
) {
  const where = `WHERE ${input.visibility === "mine" ? "r.user_id" : "r.guild_id"} = ?1
    AND instr(lower(r.title), lower(?2)) > 0 AND (?3 = '' OR r.provider = ?3)`;
  const args = [
    input.visibility === "mine" ? input.userId : input.guildId,
    input.query,
    input.provider,
  ];
  const total = z
    .object({ total: z.number() })
    .parse(
      database
        .query(
          `SELECT COUNT(*) AS total FROM playback_runs r JOIN media_items m ON m.id = r.media_item_id ${where}`,
        )
        .get(...args),
    ).total;
  const items = database
    .query(
      `SELECT r.id, r.title, r.provider, r.source_json, r.thumbnail_url, r.duration_seconds,
    r.guild_id, r.channel_id, r.user_id, r.started_at, r.ended_at, r.outcome, q.created_at
    FROM playback_runs r JOIN media_items m ON m.id = r.media_item_id
    LEFT JOIN queue_requests q ON q.id = r.queue_request_id ${where}
    ORDER BY r.started_at DESC, r.id DESC LIMIT 50 OFFSET ?4`,
    )
    .all(...args, input.offset)
    .map((row) => {
      const run = RunRowSchema.parse(row);
      return {
        ...run,
        source: SourceSchema.parse(JSON.parse(run.source_json)),
      };
    });
  return { items, total };
}

/** Rebuild the provider CHECK without changing identities or child foreign keys. */
export function migrateHistoryProviders(database: Database): void {
  const version = z
    .object({ user_version: z.number() })
    .parse(database.query("PRAGMA user_version").get()).user_version;
  if (version === 2) return;
  if (version !== 0)
    throw new Error("Unsupported media history schema version");
  database.run("PRAGMA foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.run(`CREATE TABLE media_items_next (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('local','youtube','url','streameast','tvsportslive')),
        source_identity TEXT NOT NULL, source_json TEXT NOT NULL, title TEXT NOT NULL,
        canonical_url TEXT, channel_name TEXT, thumbnail_url TEXT, duration_seconds REAL,
        updated_at INTEGER NOT NULL, UNIQUE(provider, source_identity)
      );
      INSERT INTO media_items_next SELECT * FROM media_items;
      DROP TABLE media_items;
      ALTER TABLE media_items_next RENAME TO media_items;
      CREATE INDEX IF NOT EXISTS playback_runs_user_time ON playback_runs(user_id, started_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS playback_runs_guild_time ON playback_runs(guild_id, started_at DESC, id DESC);
      ALTER TABLE playback_runs ADD COLUMN title TEXT;
      ALTER TABLE playback_runs ADD COLUMN provider TEXT;
      ALTER TABLE playback_runs ADD COLUMN source_json TEXT;
      ALTER TABLE playback_runs ADD COLUMN thumbnail_url TEXT;
      ALTER TABLE playback_runs ADD COLUMN duration_seconds REAL;
      UPDATE playback_runs SET (title, provider, source_json, thumbnail_url, duration_seconds) =
        (SELECT title, provider, source_json, thumbnail_url, duration_seconds FROM media_items WHERE id = playback_runs.media_item_id);
      PRAGMA user_version = 2;`);
      if (database.query("PRAGMA foreign_key_check").all().length > 0)
        throw new Error("Media history migration violated a foreign key");
    })();
  } finally {
    database.run("PRAGMA foreign_keys = ON");
  }
}
