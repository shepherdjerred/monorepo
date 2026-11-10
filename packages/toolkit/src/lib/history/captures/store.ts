import { Database, type SQLQueryBindings } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { captureBlocks, diffBlocks, positioned } from "./blocks.ts";
import { sha256 } from "./json.ts";

/**
 * `~/.toolkit/history/captures.sqlite`: captured agent requests.
 *
 * Unlike `index.sqlite`, nothing can rebuild it — the spool it is ingested
 * from is deleted once consumed — so it is never dropped on a schema change;
 * a future version must migrate it. Blobs are zstd-compressed and keyed by
 * the SHA-256 of their uncompressed (already redacted) bytes, so a message
 * block resent on every request of a session is stored once.
 */

const CAPTURE_SCHEMA_VERSION = 2;

function createSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS blobs (
      hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      data BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY,
      flow_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      connection_id TEXT NOT NULL,
      cli TEXT NOT NULL,
      transport TEXT NOT NULL,
      host TEXT NOT NULL,
      path TEXT NOT NULL,
      format TEXT NOT NULL,
      session_key TEXT,
      cwd TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      http_status INTEGER,
      error TEXT,
      model TEXT,
      stop_reason TEXT,
      response_id TEXT,
      previous_response_id TEXT,
      previous_capture_id INTEGER,
      context_complete INTEGER NOT NULL DEFAULT 1,
      usage_json TEXT,
      envelope_hash TEXT,
      response_hash TEXT,
      raw_request_hash TEXT,
      raw_response_hash TEXT,
      system_bytes INTEGER NOT NULL DEFAULT 0,
      tools_bytes INTEGER NOT NULL DEFAULT 0,
      history_bytes INTEGER NOT NULL DEFAULT 0,
      new_bytes INTEGER NOT NULL DEFAULT 0,
      block_count INTEGER NOT NULL DEFAULT 0,
      new_block_count INTEGER NOT NULL DEFAULT 0,
      warmup INTEGER NOT NULL DEFAULT 0,
      UNIQUE(flow_id, seq)
    );
    CREATE INDEX IF NOT EXISTS captures_session_idx ON captures(session_key, started_at);
    CREATE INDEX IF NOT EXISTS captures_started_idx ON captures(started_at);
    CREATE INDEX IF NOT EXISTS captures_response_idx ON captures(response_id);
    CREATE INDEX IF NOT EXISTS captures_flow_idx ON captures(flow_id, status);
    CREATE TABLE IF NOT EXISTS capture_blocks (
      capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      category TEXT NOT NULL,
      hash TEXT NOT NULL,
      identity TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      inherited INTEGER NOT NULL,
      is_new INTEGER NOT NULL,
      PRIMARY KEY(capture_id, section, position)
    );
    CREATE INDEX IF NOT EXISTS capture_blocks_hash_idx ON capture_blocks(hash);
    CREATE TABLE IF NOT EXISTS ws_flows (
      flow_id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      cli TEXT NOT NULL,
      host TEXT NOT NULL,
      path TEXT NOT NULL,
      session_key TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS spool_segments (
      name TEXT PRIMARY KEY,
      ingested_at TEXT NOT NULL,
      records INTEGER NOT NULL
    );
    PRAGMA user_version = ${String(CAPTURE_SCHEMA_VERSION)};
  `);
}

const MigrationRowSchema = z.object({
  id: z.number(),
  previous_capture_id: z.number().nullable(),
  new_block_count: z.number(),
});

/**
 * v1 to v2: each block stores whether it was new when ingested, so a capture
 * keeps its new blocks after the capture it was diffed against is pruned.
 * v1 novelty is recomputed against the stored predecessor and must reproduce
 * the stored `new_block_count`; a predecessor that retention already pruned
 * cannot be recomputed, so the migration fails rather than guess.
 */
function migrateV1(store: CaptureStore, database: Database): void {
  database.run(
    "ALTER TABLE capture_blocks ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0",
  );
  const rows = store
    .all("SELECT id, previous_capture_id, new_block_count FROM captures")
    .map((row) => MigrationRowSchema.parse(row));
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    const previous = row.previous_capture_id;
    if (previous !== null && !ids.has(previous)) {
      throw new Error(
        `${store.path}: capture ${String(row.id)} was diffed against capture ${String(previous)}, which was pruned, so its new blocks cannot be migrated to capture schema v2.`,
      );
    }
    const blocks = captureBlocks(store, row.id);
    const diff = diffBlocks(
      blocks,
      previous === null ? null : captureBlocks(store, previous),
    );
    if (diff.newKeys.size !== row.new_block_count) {
      throw new Error(
        `${store.path}: capture ${String(row.id)} recomputes ${String(diff.newKeys.size)} new blocks but stored ${String(row.new_block_count)}; refusing to migrate to capture schema v2.`,
      );
    }
    for (const { position, key, block } of positioned(blocks)) {
      if (!diff.newKeys.has(key)) continue;
      store.run(
        "UPDATE capture_blocks SET is_new = 1 WHERE capture_id = ? AND section = ? AND position = ?",
        row.id,
        block.section,
        position,
      );
    }
  }
  database.run("PRAGMA user_version = 2");
}

async function secure(dbPath: string): Promise<void> {
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (await Bun.file(candidate).exists()) await chmod(candidate, 0o600);
  }
}

const BlobRowSchema = z.object({ data: z.instanceof(Uint8Array) });

export class CaptureStore {
  readonly #database: Database;
  readonly #path: string;

  private constructor(database: Database, dbPath: string) {
    this.#database = database;
    this.#path = dbPath;
  }

  static async open(dbPath: string): Promise<CaptureStore> {
    await mkdir(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    const database = new Database(dbPath, { create: true, strict: true });
    database.run("PRAGMA busy_timeout = 5000;");
    database.run("PRAGMA journal_mode = WAL;");
    database.run("PRAGMA foreign_keys = ON;");
    const { user_version: version } = z
      .object({ user_version: z.number() })
      .parse(database.query("PRAGMA user_version").get());
    if (version > CAPTURE_SCHEMA_VERSION) {
      database.close();
      throw new Error(
        `${dbPath} is capture schema v${String(version)}, newer than this toolkit (v${String(CAPTURE_SCHEMA_VERSION)}); update toolkit.`,
      );
    }
    const store = new CaptureStore(database, dbPath);
    try {
      if (version === 1) {
        store.transaction(() => {
          migrateV1(store, database);
        });
      }
      createSchema(database);
    } catch (error) {
      database.close();
      throw error;
    }
    await secure(dbPath);
    return store;
  }

  get path(): string {
    return this.#path;
  }

  close(): void {
    this.#database.close();
  }

  async secure(): Promise<void> {
    await secure(this.#path);
  }

  transaction<T>(work: () => T): T {
    return this.#database.transaction(work)();
  }

  run(
    sql: string,
    ...values: SQLQueryBindings[]
  ): { changes: number; lastInsertRowid: number } {
    const result = this.#database.prepare(sql).run(...values);
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get(sql: string, ...values: SQLQueryBindings[]): unknown {
    return this.#database.prepare(sql).get(...values);
  }

  all(sql: string, ...values: SQLQueryBindings[]): unknown[] {
    return this.#database.prepare(sql).all(...values);
  }

  /** Stores bytes once, by content hash; returns the hash. */
  putBlob(contents: string | Uint8Array): string {
    const bytes =
      typeof contents === "string"
        ? new TextEncoder().encode(contents)
        : contents;
    const hash = sha256(bytes);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO blobs (hash, size, data) VALUES (?, ?, ?)",
      )
      .run(hash, bytes.length, Bun.zstdCompressSync(bytes, { level: 6 }));
    return hash;
  }

  blob(hash: string): Uint8Array {
    const row = this.#database
      .prepare("SELECT data FROM blobs WHERE hash = ?")
      .get(hash);
    if (row == null) {
      throw new Error(`Capture blob ${hash} is missing from ${this.#path}.`);
    }
    return new Uint8Array(
      Bun.zstdDecompressSync(BlobRowSchema.parse(row).data),
    );
  }

  blobText(hash: string): string {
    return new TextDecoder().decode(this.blob(hash));
  }

  blobJson(hash: string): unknown {
    return JSON.parse(this.blobText(hash));
  }
}
