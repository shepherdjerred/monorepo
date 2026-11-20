import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const MAX_IDENTITIES = 200_000;
const MAX_CACHED = 5000;
const RowSchema = z.strictObject({ analytics_id: z.uuid() });
const CountSchema = z.strictObject({ total: z.number() });

/**
 * Maps a Discord user id to a random UUID that is the only thing ever sent to PostHog. The
 * mapping lives in Streambot's state directory and never leaves the process. Lookups are
 * synchronous (bun:sqlite) behind a bounded cache, and the table is capped so an abusive id
 * stream cannot grow it without limit; past the cap no new pseudonym is minted.
 */
export class AnalyticsIdentityStore {
  private readonly database: Database;
  private readonly cache = new Map<string, string>();

  constructor(filePath: string) {
    this.database = new Database(filePath, { create: true, strict: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run(
      "CREATE TABLE IF NOT EXISTS analytics_identities (user_id TEXT PRIMARY KEY, analytics_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) WITHOUT ROWID",
    );
  }

  /** Returns the stable analytics id for a user, or `undefined` once the table is full. */
  idFor(userId: string): string | undefined {
    const cached = this.cache.get(userId);
    if (cached !== undefined) return cached;
    const id = this.lookup(userId) ?? this.create(userId);
    if (id === undefined) return undefined;
    if (this.cache.size >= MAX_CACHED) {
      const oldest = this.cache.keys().next();
      if (oldest.done !== true) this.cache.delete(oldest.value);
    }
    this.cache.set(userId, id);
    return id;
  }

  private lookup(userId: string): string | undefined {
    const row = this.database
      .query("SELECT analytics_id FROM analytics_identities WHERE user_id = ?1")
      .get(userId);
    return row === null ? undefined : RowSchema.parse(row).analytics_id;
  }

  private create(userId: string): string | undefined {
    const count = CountSchema.parse(
      this.database
        .query("SELECT COUNT(*) AS total FROM analytics_identities")
        .get(),
    ).total;
    if (count >= MAX_IDENTITIES) return undefined;
    this.database
      .query(
        "INSERT INTO analytics_identities VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO NOTHING",
      )
      .run(userId, randomUUID(), Date.now());
    return this.lookup(userId);
  }

  close(): void {
    this.database.close();
  }
}
