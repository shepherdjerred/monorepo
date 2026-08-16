import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HistoryRuntimePaths } from "./paths.ts";
import type {
  HistoryRecord,
  HistorySourceName,
  HistorySourceResult,
  HistorySourceStatus,
} from "./types.ts";

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
});

const StatusRowSchema = z.object({
  source: z.string(),
  indexed_documents: z.number(),
  last_scan_at: z.string().nullable(),
  available: z.number(),
  error: z.string().nullable(),
});

function parseSourceName(value: string): HistorySourceName {
  if (
    value === "conductor" ||
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "opencode-conductor" ||
    value === "opencode-standalone"
  ) {
    return value;
  }
  throw new Error(`Unknown history source in index: ${value}`);
}

function hashText(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

async function secureIndexFiles(indexPath: string): Promise<void> {
  for (const candidate of [indexPath, `${indexPath}-wal`, `${indexPath}-shm`]) {
    if (await Bun.file(candidate).exists()) {
      await chmod(candidate, 0o600);
    }
  }
}

function ftsQuery(query: string): string {
  const terms = query
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replaceAll('"', '""')}"*`);
  if (terms.length === 0) {
    throw new Error("Search query must contain at least one letter or number");
  }
  return terms.join(" AND ");
}

function toRecord(row: z.infer<typeof DocumentRowSchema>): HistoryRecord {
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
  };
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
      await mkdir(path.dirname(runtimePaths.indexDb), { recursive: true });
    }
    const database = new Database(runtimePaths.indexDb, {
      readonly,
      create: !readonly,
      strict: true,
    });
    const index = new HistoryIndex(database, runtimePaths.indexDb);
    if (!readonly) {
      index.#database.run(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          workspace TEXT,
          agent TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          UNIQUE(source, source_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
          title,
          body,
          content = '',
          contentless_delete = 1,
          tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE TABLE IF NOT EXISTS source_state (
          source TEXT PRIMARY KEY,
          available INTEGER NOT NULL,
          indexed_documents INTEGER NOT NULL,
          fingerprint TEXT NOT NULL,
          last_scan_at TEXT,
          error TEXT
        );
      `);
      await secureIndexFiles(runtimePaths.indexDb);
    }
    return index;
  }

  close(): void {
    this.#database.close();
  }

  async ingest(
    results: readonly HistorySourceResult[],
    force = false,
  ): Promise<void> {
    const upsert = this.#database.prepare(`
      INSERT INTO documents
        (source, source_id, title, path, workspace, agent, created_at, updated_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title = excluded.title,
        path = excluded.path,
        workspace = excluded.workspace,
        agent = excluded.agent,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        content_hash = excluded.content_hash
    `);
    const findExisting = this.#database.prepare(
      "SELECT id, content_hash FROM documents WHERE source = ? AND source_id = ?",
    );
    const insertFts = this.#database.prepare(
      "INSERT INTO history_fts(rowid, title, body) VALUES (?, ?, ?)",
    );
    const deleteFts = this.#database.prepare(
      "DELETE FROM history_fts WHERE rowid = ?",
    );
    const deleteDocument = this.#database.prepare(
      "DELETE FROM documents WHERE id = ?",
    );
    const updateState = this.#database.prepare(`
      INSERT INTO source_state
        (source, available, indexed_documents, fingerprint, last_scan_at, error)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        available = excluded.available,
        indexed_documents = excluded.indexed_documents,
        fingerprint = excluded.fingerprint,
        last_scan_at = excluded.last_scan_at,
        error = excluded.error
    `);

    const transaction = this.#database.transaction(() => {
      for (const result of results) {
        const existingIds = new Set(
          this.#database
            .prepare("SELECT id, source_id FROM documents WHERE source = ?")
            .all(result.source)
            .map((row: unknown) => {
              const parsed = z
                .object({ id: z.number(), source_id: z.string() })
                .parse(row);
              return parsed;
            }),
        );
        const seenIds = new Set<string>();
        const stateRow = this.#database
          .prepare("SELECT fingerprint FROM source_state WHERE source = ?")
          .get(result.source);
        const previousFingerprint =
          stateRow == null
            ? null
            : z.object({ fingerprint: z.string() }).parse(stateRow).fingerprint;
        const changed = force || previousFingerprint !== result.fingerprint;

        if (changed && result.available && result.error === null) {
          for (const document of result.documents) {
            seenIds.add(document.sourceId);
            const contentHash = hashText(document.searchText);
            const existing = findExisting.get(
              document.source,
              document.sourceId,
            );
            const existingRow =
              existing == null
                ? null
                : z
                    .object({ id: z.number(), content_hash: z.string() })
                    .parse(existing);
            if (
              existingRow !== null &&
              existingRow.content_hash === contentHash
            ) {
              upsert.run(
                document.source,
                document.sourceId,
                document.title,
                document.path,
                document.workspace,
                document.agent,
                document.createdAt,
                document.updatedAt,
                contentHash,
              );
              continue;
            }
            if (existingRow === null) {
              upsert.run(
                document.source,
                document.sourceId,
                document.title,
                document.path,
                document.workspace,
                document.agent,
                document.createdAt,
                document.updatedAt,
                contentHash,
              );
              const replacement = z
                .object({ id: z.number() })
                .parse(findExisting.get(document.source, document.sourceId));
              insertFts.run(
                replacement.id,
                document.title,
                document.searchText,
              );
            } else {
              deleteFts.run(existingRow.id);
              upsert.run(
                document.source,
                document.sourceId,
                document.title,
                document.path,
                document.workspace,
                document.agent,
                document.createdAt,
                document.updatedAt,
                contentHash,
              );
              const replacement = z
                .object({ id: z.number() })
                .parse(findExisting.get(document.source, document.sourceId));
              insertFts.run(
                replacement.id,
                document.title,
                document.searchText,
              );
            }
          }

          for (const existingId of existingIds) {
            if (!seenIds.has(existingId.source_id)) {
              deleteFts.run(existingId.id);
              deleteDocument.run(existingId.id);
            }
          }
        }

        updateState.run(
          result.source,
          result.available ? 1 : 0,
          changed && result.error === null
            ? result.documents.length
            : this.count(result.source),
          result.fingerprint,
          result.error === null && result.available
            ? new Date().toISOString()
            : null,
          result.error,
        );
      }
    });
    transaction();
    await secureIndexFiles(this.#indexPath);
  }

  private count(source: HistorySourceName): number {
    const row = z
      .object({ count: z.number() })
      .parse(
        this.#database
          .prepare("SELECT count(*) AS count FROM documents WHERE source = ?")
          .get(source),
      );
    return row.count;
  }

  search(
    query: string,
    options: {
      since: string | null;
      source: HistorySourceName | null;
      limit: number;
    },
  ): HistoryRecord[] {
    const clauses = ["history_fts MATCH ?"];
    const values: (string | number)[] = [ftsQuery(query)];
    if (options.since !== null) {
      clauses.push("d.updated_at >= ?");
      values.push(options.since);
    }
    if (options.source !== null) {
      clauses.push("d.source = ?");
      values.push(options.source);
    }
    values.push(options.limit);
    return this.#database
      .prepare(
        `SELECT d.id, d.source, d.source_id, d.title, d.path, d.workspace,
                d.agent, d.created_at, d.updated_at
           FROM history_fts
           JOIN documents d ON d.id = history_fts.rowid
          WHERE ${clauses.join(" AND ")}
          ORDER BY d.updated_at DESC
          LIMIT ?`,
      )
      .all(...values)
      .map((row: unknown) => toRecord(DocumentRowSchema.parse(row)));
  }

  recent(options: {
    since: string | null;
    source: HistorySourceName | null;
    limit: number;
  }): HistoryRecord[] {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (options.since !== null) {
      clauses.push("updated_at >= ?");
      values.push(options.since);
    }
    if (options.source !== null) {
      clauses.push("source = ?");
      values.push(options.source);
    }
    values.push(options.limit);
    return this.#database
      .prepare(
        `SELECT id, source, source_id, title, path, workspace, agent, created_at, updated_at
           FROM documents
          ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(...values)
      .map((row: unknown) => toRecord(DocumentRowSchema.parse(row)));
  }

  statuses(
    labels: ReadonlyMap<HistorySourceName, string>,
  ): HistorySourceStatus[] {
    const rows = this.#database
      .prepare(
        "SELECT source, indexed_documents, last_scan_at, available, error FROM source_state ORDER BY source",
      )
      .all()
      .map((row: unknown) => StatusRowSchema.parse(row));
    return rows.map((row) => ({
      source: parseSourceName(row.source),
      label: labels.get(parseSourceName(row.source)) ?? row.source,
      available: row.available === 1,
      indexedDocuments: row.indexed_documents,
      lastScanAt: row.last_scan_at,
      error: row.error,
    }));
  }

  allSourceRecords(source: HistorySourceName): HistoryRecord[] {
    return this.#database
      .prepare(
        "SELECT id, source, source_id, title, path, workspace, agent, created_at, updated_at FROM documents WHERE source = ?",
      )
      .all(source)
      .map((row: unknown) => toRecord(DocumentRowSchema.parse(row)));
  }
}

export function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const limit = Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Limit must be an integer from 1 to 200");
  }
  return limit;
}

export function parseSince(
  value: string | undefined,
  now = new Date(),
): string | null {
  if (value === undefined) {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const duration = /^(\d+)([hdw])$/u.exec(value.trim());
  if (duration !== null) {
    const amount = Number.parseInt(duration[1] ?? "", 10);
    const unit = duration[2];
    const multiplier = unit === "w" ? 7 : unit === "d" ? 1 : 1 / 24;
    return new Date(
      now.getTime() - amount * multiplier * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new TypeError(
      `Invalid --since value "${value}"; use 7d, 24h, 1w, or an ISO date`,
    );
  }
  return new Date(timestamp).toISOString();
}
