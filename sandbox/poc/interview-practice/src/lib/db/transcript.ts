import type { Database } from "bun:sqlite";
import { z } from "zod/v4";

export type TranscriptRole =
  | "user"
  | "interviewer"
  | "system"
  | "tool_call"
  | "tool_result";

const TranscriptEntrySchema = z.object({
  id: z.number(),
  role: z.enum(["user", "interviewer", "system", "tool_call", "tool_result"]),
  content: z.string(),
  metadata: z.string().nullable(),
  timestamp: z.number(),
});

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

function parseTranscriptRows(rows: unknown[]): TranscriptEntry[] {
  return rows.map((row) => TranscriptEntrySchema.parse(row));
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
  const rows = parseTranscriptRows(stmt.all(limit));
  return rows.reverse();
}

export function getAllTranscript(db: Database): TranscriptEntry[] {
  const stmt = db.prepare(
    "SELECT id, role, content, metadata, timestamp FROM transcript ORDER BY id ASC",
  );
  return parseTranscriptRows(stmt.all());
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
  return parseTranscriptRows(stmt.all(query, limit));
}
