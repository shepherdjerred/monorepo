import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HistoryRuntimePaths } from "./paths.ts";
import { ftsQuery } from "./query.ts";
import type {
  HistorySourceName,
  HistoryRuntimeRef,
  HistorySourceResult,
  HistorySourceStatus,
  IndexedHistoryRecord,
} from "./types.ts";

const INDEX_SCHEMA_VERSION = 2;

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

const SourceStateRowSchema = z.object({
  fingerprint: z.string(),
  available: z.number(),
  error: z.string().nullable(),
});

function sourceNeedsIngest(
  force: boolean,
  fingerprint: string,
  previousState: z.infer<typeof SourceStateRowSchema> | null,
): boolean {
  return (
    force ||
    previousState?.available !== 1 ||
    previousState.error !== null ||
    previousState.fingerprint !== fingerprint
  );
}

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

function hashDocument(
  title: string,
  dialogue: string,
  toolOutput: string,
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify([title, dialogue, toolOutput]));
  return hasher.digest("hex");
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
    PRAGMA user_version = ${String(INDEX_SCHEMA_VERSION)};
  `);
}

function rebuildSchema(database: Database): void {
  database.transaction(() => {
    database.run(`
      DROP TABLE IF EXISTS history_fts;
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
    const upsert = this.#database.prepare(`
      INSERT INTO documents
        (source, source_id, title, path, workspace, agent, created_at, updated_at,
         runtime_id, opening_prompt_hash, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title = excluded.title,
        path = excluded.path,
        workspace = excluded.workspace,
        agent = excluded.agent,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        runtime_id = excluded.runtime_id,
        opening_prompt_hash = excluded.opening_prompt_hash,
        content_hash = excluded.content_hash
    `);
    const findExisting = this.#database.prepare(
      "SELECT id, content_hash FROM documents WHERE source = ? AND source_id = ?",
    );
    const insertFts = this.#database.prepare(
      "INSERT INTO history_fts(rowid, title, dialogue, tool_output) VALUES (?, ?, ?, ?)",
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
        const existingIds = this.#database
          .prepare("SELECT id, source_id FROM documents WHERE source = ?")
          .all(result.source)
          .map((row: unknown) =>
            z.object({ id: z.number(), source_id: z.string() }).parse(row),
          );
        const seenIds = new Set<string>();
        const stateRow = this.#database
          .prepare(
            "SELECT fingerprint, available, error FROM source_state WHERE source = ?",
          )
          .get(result.source);
        const previousState =
          stateRow == null ? null : SourceStateRowSchema.parse(stateRow);
        const changed = sourceNeedsIngest(
          force,
          result.fingerprint,
          previousState,
        );

        if (changed && result.available && result.error === null) {
          for (const document of result.documents) {
            seenIds.add(document.sourceId);
            const contentHash = hashDocument(
              document.title,
              document.dialogueText,
              document.toolOutputText,
            );
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
              existingRow.content_hash !== contentHash
            ) {
              deleteFts.run(existingRow.id);
            }
            upsert.run(
              document.source,
              document.sourceId,
              document.title,
              document.path,
              document.workspace,
              document.agent,
              document.createdAt,
              document.updatedAt,
              document.runtimeId,
              document.openingPromptHash,
              contentHash,
            );
            if (existingRow?.content_hash !== contentHash) {
              const replacement = z
                .object({ id: z.number() })
                .parse(findExisting.get(document.source, document.sourceId));
              insertFts.run(
                replacement.id,
                document.title,
                document.dialogueText,
                document.toolOutputText,
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
    return z
      .object({ count: z.number() })
      .parse(
        this.#database
          .prepare("SELECT count(*) AS count FROM documents WHERE source = ?")
          .get(source),
      ).count;
  }

  search(query: string, options: HistoryQueryOptions): IndexedHistoryRecord[] {
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
    if (options.openingPromptHash !== undefined) {
      clauses.push("d.opening_prompt_hash = ?");
      values.push(options.openingPromptHash);
    }
    addRuntimeExclusions(clauses, values, options.excludedRuntimes ?? []);
    const pagination = options.limit === undefined ? "" : " LIMIT ? OFFSET ?";
    if (options.limit !== undefined) {
      values.push(options.limit, options.offset ?? 0);
    }
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
    const pagination = options.limit === undefined ? "" : " LIMIT ? OFFSET ?";
    if (options.limit !== undefined) {
      values.push(options.limit, options.offset ?? 0);
    }
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
}
