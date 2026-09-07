import { Database } from "bun:sqlite";
import { z } from "zod";
import type { MediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { MediaCandidate } from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  SourceSchema,
  sourceIdentity,
  withMode,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

const HistoryRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  provider: z.enum(["history", "local", "youtube"]),
  source_json: z.string().min(1),
  canonical_url: z.string().nullable(),
  channel_name: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  play_count: z.number(),
});

export type QueueRequestStatus =
  "queued" | "started" | "completed" | "failed" | "removed" | "skipped";

export type RecordMedia = {
  readonly title: string;
  readonly provider: "local" | "youtube";
  readonly source: Source;
  readonly canonicalUrl?: string | undefined;
  readonly channel?: string | undefined;
  readonly thumbnailUrl?: string | undefined;
  readonly durationSeconds?: number | undefined;
};

export type HistoryScope = {
  readonly guildId: string;
  readonly channelId: string;
  readonly userId: string;
};

/** Durable media request/history/favorites store. Raw audio and transcripts never enter this DB. */
export class MediaHistoryStore {
  private readonly database: Database;

  constructor(filePath: string) {
    this.database = new Database(filePath, { create: true, strict: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  prune(nowMs: number = Date.now()): void {
    const cutoff = nowMs - RETENTION_MS;
    this.database
      .query("DELETE FROM playback_runs WHERE started_at < ?1")
      .run(cutoff);
    this.database
      .query("DELETE FROM queue_requests WHERE created_at < ?1")
      .run(cutoff);
  }

  recordQueueRequest(input: {
    readonly scope: HistoryScope;
    readonly rawQuery: string;
    readonly intent: MediaIntent;
    readonly media?: RecordMedia;
    readonly status?: QueueRequestStatus;
    readonly errorCode?: string;
    readonly nowMs?: number;
  }): string {
    const requestId = crypto.randomUUID();
    const mediaItemId =
      input.media === undefined ? null : this.upsertMedia(input.media);
    this.database
      .query(
        `INSERT INTO queue_requests
          (id, guild_id, channel_id, user_id, raw_query, intent_json, media_item_id, status, error_code, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .run(
        requestId,
        input.scope.guildId,
        input.scope.channelId,
        input.scope.userId,
        input.rawQuery,
        JSON.stringify(input.intent),
        mediaItemId,
        input.status ?? "queued",
        input.errorCode ?? null,
        input.nowMs ?? Date.now(),
      );
    return requestId;
  }

  updateRequest(requestId: string, status: QueueRequestStatus): void {
    this.database
      .query("UPDATE queue_requests SET status = ?1 WHERE id = ?2")
      .run(status, requestId);
  }

  finishStartedRequest(
    requestId: string,
    status: "completed" | "failed" | "skipped",
  ): void {
    this.database
      .query(
        "UPDATE queue_requests SET status = ?1 WHERE id = ?2 AND status IN ('queued', 'started')",
      )
      .run(status, requestId);
  }

  recordPlaybackStart(input: {
    readonly requestId?: string;
    readonly scope: HistoryScope;
    readonly media: RecordMedia;
    readonly positionSeconds?: number;
    readonly nowMs?: number;
  }): string {
    const mediaItemId = this.upsertMedia(input.media);
    const runId = crypto.randomUUID();
    const nowMs = input.nowMs ?? Date.now();
    this.database
      .query(
        `INSERT INTO playback_runs
          (id, queue_request_id, media_item_id, guild_id, channel_id, user_id, started_at, start_position_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .run(
        runId,
        input.requestId ?? null,
        mediaItemId,
        input.scope.guildId,
        input.scope.channelId,
        input.scope.userId,
        nowMs,
        input.positionSeconds ?? 0,
      );
    if (input.requestId !== undefined) {
      this.database
        .query(
          "UPDATE queue_requests SET status = 'started' WHERE id = ?1 AND status = 'queued'",
        )
        .run(input.requestId);
    }
    return runId;
  }

  search(scope: HistoryScope, query: string, limit = 10): MediaCandidate[] {
    const like = `%${query.trim().toLocaleLowerCase("en-US")}%`;
    const rows = this.database
      .query(
        `SELECT m.*, COUNT(r.id) AS play_count
           FROM playback_runs r
           JOIN media_items m ON m.id = r.media_item_id
          WHERE (r.user_id = ?1 OR r.guild_id = ?2)
            AND (?3 = '%%' OR lower(m.title) LIKE ?3)
          GROUP BY m.id
          ORDER BY MAX(CASE WHEN r.user_id = ?1 THEN r.started_at ELSE 0 END) DESC,
                   MAX(CASE WHEN r.guild_id = ?2 THEN r.started_at ELSE 0 END) DESC,
                   MAX(r.started_at) DESC
          LIMIT ?4`,
      )
      .all(scope.userId, scope.guildId, like, limit);
    return rows.map((row, index) => this.rowToCandidate(row, index));
  }

  previous(
    scope: HistoryScope,
    excludeSourceIdentity?: string,
  ): MediaCandidate | null {
    const rows = this.database
      .query(
        `SELECT m.*, COUNT(r.id) AS play_count
           FROM playback_runs r
           JOIN media_items m ON m.id = r.media_item_id
          WHERE r.guild_id = ?1
          GROUP BY m.id
          ORDER BY MAX(r.started_at) DESC
          LIMIT ?2`,
      )
      .all(scope.guildId, 25);
    return (
      rows
        .map((row, index) => this.rowToCandidate(row, index))
        .find(
          (candidate) =>
            excludeSourceIdentity === undefined ||
            sourceIdentity(candidate.source) !== excludeSourceIdentity,
        ) ?? null
    );
  }

  list(
    scope: HistoryScope,
    visibility: "mine" | "server",
    limit = 25,
  ): MediaCandidate[] {
    const column = visibility === "mine" ? "r.user_id" : "r.guild_id";
    const value = visibility === "mine" ? scope.userId : scope.guildId;
    const rows = this.database
      .query(
        `SELECT m.*, COUNT(r.id) AS play_count
           FROM playback_runs r JOIN media_items m ON m.id = r.media_item_id
          WHERE ${column} = ?1 GROUP BY m.id
          ORDER BY MAX(r.started_at) DESC LIMIT ?2`,
      )
      .all(value, limit);
    return rows.map((row, index) => this.rowToCandidate(row, index));
  }

  addFavorite(userId: string, media: RecordMedia): void {
    const mediaItemId = this.upsertMedia(media);
    this.database
      .query(
        `INSERT INTO favorites (user_id, media_item_id, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, media_item_id) DO NOTHING`,
      )
      .run(userId, mediaItemId, Date.now());
  }

  removeFavorite(userId: string, mediaItemId: string): void {
    this.database
      .query("DELETE FROM favorites WHERE user_id = ?1 AND media_item_id = ?2")
      .run(userId, mediaItemId);
  }

  favorites(userId: string, limit = 25): MediaCandidate[] {
    const rows = this.database
      .query(
        `SELECT m.*, 1 AS play_count
           FROM favorites f JOIN media_items m ON m.id = f.media_item_id
          WHERE f.user_id = ?1 ORDER BY f.created_at DESC LIMIT ?2`,
      )
      .all(userId, limit);
    return rows.map((row, index) => this.rowToCandidate(row, index));
  }

  usual(scope: HistoryScope): MediaCandidate | null {
    const rows = this.database
      .query(
        `SELECT m.*, COUNT(r.id) AS play_count
           FROM playback_runs r JOIN media_items m ON m.id = r.media_item_id
          WHERE r.user_id = ?1 GROUP BY m.id
          ORDER BY play_count DESC, MAX(r.started_at) DESC LIMIT 1`,
      )
      .all(scope.userId);
    return rows.length === 0 ? null : this.rowToCandidate(rows[0], 0);
  }

  saveQueue(userId: string, name: string, items: readonly RecordMedia[]): void {
    const queueId = crypto.randomUUID();
    const transaction = this.database.transaction(() => {
      this.database
        .query(
          `INSERT INTO saved_queues (id, user_id, name, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?4)
           ON CONFLICT(user_id, name) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        .run(queueId, userId, name, Date.now());
      const stored = this.database
        .query("SELECT id FROM saved_queues WHERE user_id = ?1 AND name = ?2")
        .get(userId, name);
      const id = z.object({ id: z.string() }).parse(stored).id;
      this.database
        .query("DELETE FROM saved_queue_items WHERE saved_queue_id = ?1")
        .run(id);
      items.forEach((item, index) => {
        const mediaId = this.upsertMedia(item);
        this.database
          .query(
            `INSERT INTO saved_queue_items (saved_queue_id, position, media_item_id)
             VALUES (?1, ?2, ?3)`,
          )
          .run(id, index + 1, mediaId);
      });
    });
    transaction();
  }

  savedQueue(userId: string, name: string): MediaCandidate[] {
    const rows = this.database
      .query(
        `SELECT m.*, 1 AS play_count
           FROM saved_queues q
           JOIN saved_queue_items i ON i.saved_queue_id = q.id
           JOIN media_items m ON m.id = i.media_item_id
          WHERE q.user_id = ?1 AND q.name = ?2 ORDER BY i.position ASC`,
      )
      .all(userId, name);
    return rows.map((row, index) => this.rowToCandidate(row, index));
  }

  savedQueueNames(userId: string): string[] {
    return this.database
      .query(
        "SELECT name FROM saved_queues WHERE user_id = ?1 ORDER BY updated_at DESC",
      )
      .all(userId)
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  }

  deleteSavedQueue(userId: string, name: string): void {
    this.database
      .query("DELETE FROM saved_queues WHERE user_id = ?1 AND name = ?2")
      .run(userId, name);
  }

  private upsertMedia(media: RecordMedia): string {
    const identity = sourceIdentity(media.source);
    // Store the item, not the request. A `mode:` override is a property of ONE play — "this time,
    // watch it" — and `source_json` is what every later replay (favorites, /stream again, history
    // requeue) is rebuilt from. Persisting the override verbatim would pin the item to that
    // transport forever, and because `sourceIdentity` ignores `mode`, the very next play of the
    // same URL would overwrite this row and silently inherit it. Resume state is the opposite case
    // and deliberately keeps the real mode: it is the same play continuing, not a new one.
    //
    // Stripped rather than set to `"auto"`, which is the same thing to every reader of `Source` and
    // additionally keeps this column byte-identical to what it holds today for any item requested
    // without a mode — no silent rewrite of every history row on deploy.
    const source = withMode(media.source, undefined);
    const id = crypto.randomUUID();
    this.database
      .query(
        `INSERT INTO media_items
          (id, provider, source_identity, source_json, title, canonical_url, channel_name, thumbnail_url, duration_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(provider, source_identity) DO UPDATE SET
           title = excluded.title,
           source_json = excluded.source_json,
           canonical_url = excluded.canonical_url,
           channel_name = excluded.channel_name,
           thumbnail_url = excluded.thumbnail_url,
           duration_seconds = excluded.duration_seconds,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        media.provider,
        identity,
        JSON.stringify(source),
        media.title,
        media.canonicalUrl ?? null,
        media.channel ?? null,
        media.thumbnailUrl ?? null,
        media.durationSeconds ?? null,
        Date.now(),
      );
    const row = this.database
      .query(
        "SELECT id FROM media_items WHERE provider = ?1 AND source_identity = ?2",
      )
      .get(media.provider, identity);
    return z.object({ id: z.string() }).parse(row).id;
  }

  private rowToCandidate(row: unknown, index: number): MediaCandidate {
    const parsed = HistoryRowSchema.parse(row);
    const source = SourceSchema.parse(JSON.parse(parsed.source_json));
    return {
      token: parsed.id,
      provider: "history",
      title: parsed.title,
      source,
      score: 1000 - index + Math.min(parsed.play_count, 20),
      ...(parsed.canonical_url === null
        ? {}
        : { canonicalUrl: parsed.canonical_url }),
      ...(parsed.channel_name === null ? {} : { channel: parsed.channel_name }),
      ...(parsed.thumbnail_url === null
        ? {}
        : { thumbnailUrl: parsed.thumbnail_url }),
      ...(parsed.duration_seconds === null
        ? {}
        : { durationSeconds: parsed.duration_seconds }),
      reason: "played before",
    };
  }

  private migrate(): void {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('local', 'youtube')),
        source_identity TEXT NOT NULL,
        source_json TEXT NOT NULL,
        title TEXT NOT NULL,
        canonical_url TEXT,
        channel_name TEXT,
        thumbnail_url TEXT,
        duration_seconds REAL,
        updated_at INTEGER NOT NULL,
        UNIQUE(provider, source_identity)
      );
      CREATE TABLE IF NOT EXISTS queue_requests (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        raw_query TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        media_item_id TEXT REFERENCES media_items(id),
        status TEXT NOT NULL CHECK(status IN ('queued','started','completed','failed','removed','skipped')),
        error_code TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS queue_requests_scope_time ON queue_requests(user_id, guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS playback_runs (
        id TEXT PRIMARY KEY,
        queue_request_id TEXT REFERENCES queue_requests(id),
        media_item_id TEXT NOT NULL REFERENCES media_items(id),
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        start_position_seconds REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS playback_runs_scope_time ON playback_runs(user_id, guild_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL,
        media_item_id TEXT NOT NULL REFERENCES media_items(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, media_item_id)
      );
      CREATE TABLE IF NOT EXISTS saved_queues (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS saved_queue_items (
        saved_queue_id TEXT NOT NULL REFERENCES saved_queues(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        media_item_id TEXT NOT NULL REFERENCES media_items(id),
        PRIMARY KEY(saved_queue_id, position)
      );
    `);
  }
}
