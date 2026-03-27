import type { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transcript (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL CHECK(role IN ('user','interviewer','system','tool_call','tool_result')),
  content    TEXT NOT NULL,
  metadata   TEXT,
  timestamp  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcript_ts ON transcript(timestamp);

CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  content, role, tokenize='porter unicode61', content=transcript, content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS transcript_ai AFTER INSERT ON transcript BEGIN
  INSERT INTO transcript_fts(rowid, content, role) VALUES (new.id, new.content, new.role);
END;

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event     TEXT NOT NULL,
  data      TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);

CREATE TABLE IF NOT EXISTS metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function initializeSchema(db: Database): void {
  db.exec(SCHEMA);
}
