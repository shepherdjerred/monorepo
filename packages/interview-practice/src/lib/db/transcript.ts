import type { Database } from "bun:sqlite";

export type TranscriptRole =
  | "user"
  | "interviewer"
  | "system"
  | "tool_call"
  | "tool_result";

export type TranscriptEntry = {
  id: number;
  role: TranscriptRole;
  content: string;
  metadata: string | null;
  timestamp: number;
}

export function insertTranscript(
  db: Database,
  role: TranscriptRole,
  content: string,
  metadata?: Record<string, unknown>,
): number {
  const stmt = db.prepare(
    "INSERT INTO transcript (role, content, metadata, timestamp) VALUES (?, ?, ?, ?)",
  );
  const result = stmt.run(
    role,
    content,
    metadata ? JSON.stringify(metadata) : null,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function getTranscriptWindow(
  db: Database,
  limit: number,
): TranscriptEntry[] {
  const stmt = db.prepare(
    "SELECT id, role, content, metadata, timestamp FROM transcript ORDER BY id DESC LIMIT ?",
  );
  const rows = stmt.all(limit) as TranscriptEntry[];
  return rows.reverse();
}

export function getAllTranscript(db: Database): TranscriptEntry[] {
  const stmt = db.prepare(
    "SELECT id, role, content, metadata, timestamp FROM transcript ORDER BY id ASC",
  );
  return stmt.all() as TranscriptEntry[];
}

export function searchTranscript(
  db: Database,
  query: string,
  limit = 10,
): TranscriptEntry[] {
  const stmt = db.prepare(
    `SELECT t.id, t.role, t.content, t.metadata, t.timestamp
     FROM transcript_fts fts
     JOIN transcript t ON fts.rowid = t.id
     WHERE transcript_fts MATCH ?
     ORDER BY rank
     LIMIT ?`,
  );
  return stmt.all(query, limit) as TranscriptEntry[];
}
