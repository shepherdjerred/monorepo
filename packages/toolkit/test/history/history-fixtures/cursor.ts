import path from "node:path";
import { writeDatabase } from "./database.ts";

export function writeCursorFixture(cursorDir: string): string {
  const cursorDb = path.join(cursorDir, "conversation-search.db");
  writeDatabase(
    cursorDb,
    `
      CREATE TABLE conversations (fts_rowid INTEGER PRIMARY KEY, source TEXT, scope TEXT, id TEXT,
        title TEXT, updated_at INTEGER, is_archived INTEGER, root_fingerprint TEXT, cache_fingerprint TEXT);
      CREATE VIRTUAL TABLE conversation_fts USING fts5(title, body);
    `,
    (database) => {
      database.run(
        "INSERT INTO conversations VALUES (1, 'local', '', 'c1', 'Cursor fix', 1786406400000, 0, 'root', NULL)",
      );
      database
        .prepare(
          "INSERT INTO conversation_fts(rowid, title, body) VALUES (1, ?, ?)",
        )
        .run(
          "Cursor fix",
          `Resolve TypeScript typecheck ${"routine cursor context ".repeat(1000)}cursor-tail-search-marker`,
        );
    },
  );
  return cursorDb;
}
