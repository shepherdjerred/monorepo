import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HistoryRuntimePaths } from "./paths.ts";
import { ftsQuery } from "./query/query.ts";
import {
  parseHistorySourceName,
  type HistoryRuntimeRef,
  type HistorySourceName,
  type HistorySourceResult,
  type HistorySourceStatus,
  type IndexedHistoryRecord,
  type UsageReport,
} from "./types.ts";
import { ingestResults } from "./ingest.ts";
import { queryUsage, type UsageQueryOptions } from "./usage-query.ts";

const INDEX_SCHEMA_VERSION = 3;

type HistoryQueryOptions = {
  readonly since: string | null;
  readonly source: HistorySourceName | null;
  readonly limit?: number;
  readonly offset?: number;
  readonly openingPromptHash?: string;
  readonly excludedRuntimes?: readonly HistoryRuntimeRef[];
};

const DocumentRowSchema = z.object({
  id: z.number(),
  source: z.string(),
  source_id: z.string(),
  title: z.string(),
  path: z.string(),
  workspace: z.string().nullable(),
  agent: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  runtime_id: z.string().nullable(),
  opening_prompt_hash: z.string().nullable(),
});

const StatusRowSchema = z.object({
  source: z.string(),
  indexed_documents: z.number(),
  last_scan_at: z.string().nullable(),
  available: z.number(),
  error: z.string().nullable(),
});

function addRuntimeExclusions(
  clauses: string[],
  values: (string | number)[],
  exclusions: readonly HistoryRuntimeRef[],
): void {
  for (const exclusion of exclusions) {
    clauses.push(
      "(d.source != ? OR d.runtime_id IS NULL OR d.runtime_id != ?)",
    );
    values.push(exclusion.source, exclusion.runtimeId);
  }
}

function parseSourceName(value: string): HistorySourceName {
  return parseHistorySourceName(value, "in index");
}

function filterClauses(options: HistoryQueryOptions): {
  clauses: string[];
  values: (string | number)[];
} {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (options.since !== null) {
    clauses.push("d.updated_at >= ?");
    values.push(options.since);
  }
  if (options.source !== null) {
    clauses.push("d.source = ?");
    values.push(options.source);
  }
  if (options.openingPromptHash !== undefined) {
    clauses.push("d.opening_prompt_hash = ?");
    values.push(options.openingPromptHash);
  }
  addRuntimeExclusions(clauses, values, options.excludedRuntimes ?? []);
  return { clauses, values };
}

function paginationClause(
  options: HistoryQueryOptions,
  values: (string | number)[],
): string {
  if (options.limit === undefined) {
    return "";
  }
  values.push(options.limit, options.offset ?? 0);
  return " LIMIT ? OFFSET ?";
}

async function secureIndexFiles(indexPath: string): Promise<void> {
  await chmod(path.dirname(indexPath), 0o700);
  for (const candidate of [indexPath, `${indexPath}-wal`, `${indexPath}-shm`]) {
    if (await Bun.file(candidate).exists()) {
      await chmod(candidate, 0o600);
    }
  }
}

function toRecord(
  row: z.infer<typeof DocumentRowSchema>,
): IndexedHistoryRecord {
  return {
    id: row.id,
    source: parseSourceName(row.source),
    sourceId: row.source_id,
    title: row.title,
    path: row.path,
    workspace: row.workspace,
    agent: row.agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    excerpt: null,
    runtimeId: row.runtime_id,
    openingPromptHash: row.opening_prompt_hash,
  };
}

function schemaVersion(database: Database): number {
  return z
    .object({ user_version: z.number() })
    .parse(database.query("PRAGMA user_version").get()).user_version;
}

function createSchema(database: Database): void {
  database.run(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      workspace TEXT,
      agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      runtime_id TEXT,
      opening_prompt_hash TEXT,
      content_hash TEXT NOT NULL,
      UNIQUE(source, source_id)
    );
    CREATE VIRTUAL TABLE history_fts USING fts5(
      title,
      dialogue,
      tool_output,
      content = '',
      contentless_delete = 1,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE source_state (
      source TEXT PRIMARY KEY,
      available INTEGER NOT NULL,
      indexed_documents INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      last_scan_at TEXT,
      error TEXT
    );
    CREATE TABLE usage_events (
      document_id INTEGER NOT NULL REFERENCES documents(id),
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      cost_complete INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX usage_events_document_id_idx ON usage_events(document_id);
    CREATE INDEX usage_events_occurred_at_idx ON usage_events(occurred_at);
    PRAGMA user_version = ${String(INDEX_SCHEMA_VERSION)};
  `);
}

function rebuildSchema(database: Database): void {
  database.transaction(() => {
    database.run(`
      DROP TABLE IF EXISTS history_fts;
      DROP TABLE IF EXISTS usage_events;
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS source_state;
    `);
    createSchema(database);
  })();
}

export class HistoryIndex {
  readonly #database: Database;
  readonly #indexPath: string;

  private constructor(database: Database, indexPath: string) {
    this.#database = database;
    this.#indexPath = indexPath;
  }

  static async open(
    runtimePaths: HistoryRuntimePaths,
    readonly = false,
  ): Promise<HistoryIndex> {
    if (!readonly) {
      await mkdir(path.dirname(runtimePaths.indexDb), {
        recursive: true,
        mode: 0o700,
      });
    }
    const database = new Database(runtimePaths.indexDb, {
      readonly,
      create: !readonly,
      strict: true,
    });
    const version = schemaVersion(database);
    if (readonly && version !== INDEX_SCHEMA_VERSION) {
      database.close();
      throw new Error(
        `History index schema is v${String(version)}; restart the daemon to rebuild v${String(INDEX_SCHEMA_VERSION)}.`,
      );
    }
    const index = new HistoryIndex(database, runtimePaths.indexDb);
    if (!readonly) {
      try {
        index.#database.run(
          "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        );
        if (version !== INDEX_SCHEMA_VERSION) {
          rebuildSchema(index.#database);
        }
        await secureIndexFiles(runtimePaths.indexDb);
      } catch (error) {
        index.close();
        throw error;
      }
    }
    return index;
  }

  close(): void {
    this.#database.close();
  }

  readSnapshot<T>(callback: () => T): T {
    return this.#database.transaction(callback)();
  }

  async ingest(
    results: readonly HistorySourceResult[],
    force = false,
  ): Promise<void> {
    if (force) {
      rebuildSchema(this.#database);
    }
    ingestResults(this.#database, results, force);
    await secureIndexFiles(this.#indexPath);
  }

  search(query: string, options: HistoryQueryOptions): IndexedHistoryRecord[] {
    const { clauses, values } = filterClauses(options);
    clauses.unshift("history_fts MATCH ?");
    values.unshift(ftsQuery(query));
    const pagination = paginationClause(options, values);
    return this.#database
      .prepare(
        `SELECT d.id, d.source, d.source_id, d.title, d.path, d.workspace,
                d.agent, d.created_at, d.updated_at, d.runtime_id,
                d.opening_prompt_hash
           FROM history_fts
          JOIN documents d ON d.id = history_fts.rowid
          WHERE ${clauses.join(" AND ")}
          ORDER BY bm25(history_fts, 8.0, 3.0, 0.25), d.updated_at DESC,
                   d.id ASC${pagination}`,
      )
      .all(...values)
      .map((row: unknown) => toRecord(DocumentRowSchema.parse(row)));
  }

  recent(options: HistoryQueryOptions): IndexedHistoryRecord[] {
    const { clauses, values } = filterClauses(options);
    const pagination = paginationClause(options, values);
    return this.#database
      .prepare(
        `SELECT id, source, source_id, title, path, workspace, agent,
                created_at, updated_at, runtime_id, opening_prompt_hash
           FROM documents d
          ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
          ORDER BY updated_at DESC, id ASC${pagination}`,
      )
      .all(...values)
      .map((row: unknown) => toRecord(DocumentRowSchema.parse(row)));
  }

  record(id: number): IndexedHistoryRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id, source, source_id, title, path, workspace, agent,
                created_at, updated_at, runtime_id, opening_prompt_hash
           FROM documents WHERE id = ?`,
      )
      .get(id);
    return row == null ? null : toRecord(DocumentRowSchema.parse(row));
  }

  statuses(
    labels: ReadonlyMap<HistorySourceName, string>,
  ): HistorySourceStatus[] {
    return this.#database
      .prepare(
        "SELECT source, indexed_documents, last_scan_at, available, error FROM source_state ORDER BY source",
      )
      .all()
      .map((row: unknown) => StatusRowSchema.parse(row))
      .map((row) => {
        const source = parseSourceName(row.source);
        return {
          source,
          label: labels.get(source) ?? row.source,
          available: row.available === 1,
          indexedDocuments: row.indexed_documents,
          lastScanAt: row.last_scan_at,
          error: row.error,
        };
      });
  }

  usage(options: UsageQueryOptions): UsageReport {
    return queryUsage(this.#database, options);
  }
}
