import { Database } from "bun:sqlite";
import * as lancedb from "@lancedb/lancedb";
import { mkdir } from "node:fs/promises";
import {
  LANCE_DIR,
  SQLITE_PATH,
  RECALL_DIR,
  EMBEDDING_DIM,
} from "./config.ts";

const SCHEMA_VERSION = 1;
const LANCE_TABLE = "chunks";

export type ChunkRow = {
  id: string;
  doc_path: string;
  chunk_index: number;
  text: string;
  vector: number[];
};

export type MetadataRow = {
  path: string;
  title: string;
  tags: string;
  source: string;
  content_hash: string;
  mtime: number;
  chunk_count: number;
  indexed_at: string;
};

export class RecallDb {
  readonly sqlite: Database;
  private lanceDb: lancedb.Connection | null = null;
  private lanceTable: lancedb.Table | null = null;

  constructor(sqlitePath: string = SQLITE_PATH) {
    this.sqlite = new Database(sqlitePath);
    this.sqlite.run("PRAGMA journal_mode = WAL;");
    this.initSchema();
  }

  private initSchema(): void {
    // Metadata table
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS metadata (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        mtime REAL NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT NOT NULL
      )
    `);

    // FTS5 for keyword search
    this.sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        path, title, tags, body,
        tokenize='porter unicode61'
      )
    `);

    // Stats table for telemetry
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        event TEXT NOT NULL,
        duration_ms REAL,
        details TEXT
      )
    `);

    // Meta table for schema version etc.
    this.sqlite.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Check/set schema version
    const row = this.sqlite
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    if (row == null) {
      this.sqlite.run(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
        [String(SCHEMA_VERSION)],
      );
    }
  }

  async getLanceTable(): Promise<lancedb.Table> {
    if (this.lanceTable != null) {
      return this.lanceTable;
    }

    await mkdir(LANCE_DIR, { recursive: true });
    this.lanceDb = await lancedb.connect(LANCE_DIR);

    const tableNames = await this.lanceDb.tableNames();
    if (tableNames.includes(LANCE_TABLE)) {
      this.lanceTable = await this.lanceDb.openTable(LANCE_TABLE);
    } else {
      // Create with a dummy row that we immediately delete
      // LanceDB requires at least one row to infer schema
      this.lanceTable = await this.lanceDb.createTable(LANCE_TABLE, [
        {
          id: "__init__",
          doc_path: "",
          chunk_index: 0,
          text: "",
          vector: Array.from<number>({ length: EMBEDDING_DIM }).fill(0),
        },
      ]);
      await this.lanceTable.delete('id = "__init__"');
    }

    return this.lanceTable;
  }

  // Metadata operations

  getMetadata(docPath: string): MetadataRow | null {
    return this.sqlite
      .query<MetadataRow, [string]>("SELECT * FROM metadata WHERE path = ?")
      .get(docPath) ?? null;
  }

  upsertMetadata(meta: MetadataRow): void {
    this.sqlite.run(
      `INSERT OR REPLACE INTO metadata (path, title, tags, source, content_hash, mtime, chunk_count, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meta.path,
        meta.title,
        meta.tags,
        meta.source,
        meta.content_hash,
        meta.mtime,
        meta.chunk_count,
        meta.indexed_at,
      ],
    );
  }

  deleteMetadata(docPath: string): void {
    this.sqlite.run("DELETE FROM metadata WHERE path = ?", [docPath]);
  }

  // FTS operations

  upsertFts(docPath: string, title: string, tags: string, body: string): void {
    this.sqlite.run("DELETE FROM docs_fts WHERE path = ?", [docPath]);
    this.sqlite.run(
      "INSERT INTO docs_fts (path, title, tags, body) VALUES (?, ?, ?, ?)",
      [docPath, title, tags, body],
    );
  }

  deleteFts(docPath: string): void {
    this.sqlite.run("DELETE FROM docs_fts WHERE path = ?", [docPath]);
  }

  searchFts(
    query: string,
    limit: number,
  ): { path: string; title: string; body: string; rank: number }[] {
    if (query.trim() === "") return [];

    // Sanitize FTS5 query
    const sanitized = query
      .trim()
      .replaceAll(/[*"^{}:()]/g, " ")
      .replaceAll(/\b(?:AND|OR|NOT|NEAR)\b/gi, " ");
    const terms = sanitized.split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) return [];

    const ftsQuery = terms.map((t) => `"${t}"*`).join(" OR ");

    return this.sqlite
      .query<
        { path: string; title: string; body: string; rank: number },
        [string, number]
      >(
        "SELECT path, title, body, rank FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank LIMIT ?",
      )
      .all(ftsQuery, limit);
  }

  // Stats operations

  recordStat(event: string, durationMs: number, details: Record<string, unknown>): void {
    this.sqlite.run(
      "INSERT INTO stats (ts, event, duration_ms, details) VALUES (?, ?, ?, ?)",
      [new Date().toISOString(), event, durationMs, JSON.stringify(details)],
    );
  }

  purgeOldStats(daysToKeep = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const result = this.sqlite.run(
      "DELETE FROM stats WHERE ts < ?",
      [cutoff.toISOString()],
    );
    return result.changes;
  }

  // Vector operations (delegated to LanceDB)

  async addChunks(chunks: ChunkRow[]): Promise<void> {
    if (chunks.length === 0) return;
    const table = await this.getLanceTable();
    await table.add(chunks);
  }

  async deleteChunks(docPath: string): Promise<void> {
    const table = await this.getLanceTable();
    await table.delete(`doc_path = "${docPath.replaceAll('"', String.raw`\"`)}"`);
  }

  async vectorSearch(
    queryVector: number[],
    limit: number,
  ): Promise<(ChunkRow & { _distance: number })[]> {
    const table = await this.getLanceTable();
    const results = await table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();
    return results as (ChunkRow & { _distance: number })[];
  }

  // Aggregate queries

  getDocCount(): number {
    return (
      this.sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM metadata")
        .get()?.count ?? 0
    );
  }

  getChunkCount(): number {
    return (
      this.sqlite
        .query<{ total: number }, []>(
          "SELECT COALESCE(SUM(chunk_count), 0) as total FROM metadata",
        )
        .get()?.total ?? 0
    );
  }

  getSourceStats(): { source: string; docs: number; chunks: number }[] {
    return this.sqlite
      .query<{ source: string; docs: number; chunks: number }, []>(
        "SELECT source, COUNT(*) as docs, COALESCE(SUM(chunk_count), 0) as chunks FROM metadata GROUP BY source ORDER BY docs DESC",
      )
      .all();
  }

  // Cleanup

  async dropAll(): Promise<void> {
    this.sqlite.run("DELETE FROM metadata");
    this.sqlite.run("DELETE FROM docs_fts");
    this.sqlite.run("DELETE FROM stats");

    if (this.lanceDb != null) {
      const tables = await this.lanceDb.tableNames();
      if (tables.includes(LANCE_TABLE)) {
        await this.lanceDb.dropTable(LANCE_TABLE);
      }
      this.lanceTable = null;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}

export async function createRecallDb(): Promise<RecallDb> {
  await mkdir(RECALL_DIR, { recursive: true });
  return new RecallDb();
}
