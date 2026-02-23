import { Database } from "bun:sqlite";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { listNotes, readNote } from "./index.ts";

const log = logger.child({ module: "memory-indexer" });

export type SearchResult = {
  path: string;
  title: string;
  tags: string;
  body: string;
  rank: number;
};

export class MemoryIndexer {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, tags, body)",
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS note_meta (path TEXT PRIMARY KEY, mtime REAL)",
    );
  }

  async indexAll(memoryDir: string): Promise<number> {
    const files = await listNotes(memoryDir);
    let indexed = 0;

    const getMtime = this.db.prepare<{ mtime: number }, [string]>(
      "SELECT mtime FROM note_meta WHERE path = ?",
    );
    const upsertMeta = this.db.prepare(
      "INSERT OR REPLACE INTO note_meta (path, mtime) VALUES (?, ?)",
    );
    const deleteFts = this.db.prepare(
      "DELETE FROM notes_fts WHERE path = ?",
    );
    const insertFts = this.db.prepare(
      "INSERT INTO notes_fts (path, title, tags, body) VALUES (?, ?, ?, ?)",
    );

    for (const filePath of files) {
      try {
        const fileStat = await stat(filePath);
        const mtimeMs = fileStat.mtimeMs;

        const existing = getMtime.get(filePath);
        if (existing?.mtime === mtimeMs) {
          continue;
        }

        const note = await readNote(filePath);

        const transaction = this.db.transaction(() => {
          deleteFts.run(filePath);
          insertFts.run(filePath, note.title, note.tags.join(" "), note.body);
          upsertMeta.run(filePath, mtimeMs);
        });
        transaction();

        indexed++;
      } catch (error) {
        log.warn({ path: filePath, error }, "skipping malformed file");
      }
    }

    log.info(
      { total: files.length, indexed, dir: memoryDir },
      "indexing complete",
    );
    return indexed;
  }

  search(query: string, limit = 10): SearchResult[] {
    if (query.trim() === "") {
      return [];
    }

    // Sanitize: remove FTS5 special syntax to prevent query injection.
    // Strip operators (AND, OR, NOT, NEAR) and special chars (*, ", ^, {, }, :)
    const sanitized = query
      .trim()
      .replaceAll(/[*"^{}:()]/g, " ")
      .replaceAll(/\b(?:AND|OR|NOT|NEAR)\b/gi, " ");

    const terms = sanitized
      .split(/\s+/)
      .filter((term) => term.length > 0);

    if (terms.length === 0) {
      return [];
    }

    // Use prefix matching with OR for better recall.
    // Each term is wrapped in double quotes to escape any remaining special chars.
    const ftsQuery = terms
      .map((term) => `"${term}"*`)
      .join(" OR ");

    const stmt = this.db.prepare<
      { path: string; title: string; tags: string; body: string; rank: number },
      [string, number]
    >(
      "SELECT path, title, tags, body, rank FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?",
    );

    return stmt.all(ftsQuery, limit);
  }

  close(): void {
    this.db.close();
  }
}

export async function createIndexer(
  memoryDir = "data/memory",
): Promise<MemoryIndexer> {
  await mkdir(memoryDir, { recursive: true });
  const dbPath = path.join(memoryDir, ".index.sqlite");
  return new MemoryIndexer(dbPath);
}
