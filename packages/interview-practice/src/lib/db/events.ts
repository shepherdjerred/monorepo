import type { Database } from "bun:sqlite";

export type SessionEvent = {
  id: number;
  event: string;
  data: string | null;
  timestamp: number;
}

export function insertEvent(
  db: Database,
  event: string,
  data?: Record<string, unknown>,
): number {
  const stmt = db.prepare(
    "INSERT INTO events (event, data, timestamp) VALUES (?, ?, ?)",
  );
  const result = stmt.run(event, data ? JSON.stringify(data) : null, Date.now());
  return Number(result.lastInsertRowid);
}

export function queryEvents(
  db: Database,
  eventType?: string,
  limit = 100,
): SessionEvent[] {
  if (eventType) {
    const stmt = db.prepare(
      "SELECT id, event, data, timestamp FROM events WHERE event = ? ORDER BY id DESC LIMIT ?",
    );
    return stmt.all(eventType, limit) as SessionEvent[];
  }
  const stmt = db.prepare(
    "SELECT id, event, data, timestamp FROM events ORDER BY id DESC LIMIT ?",
  );
  return stmt.all(limit) as SessionEvent[];
}

export function countEvents(db: Database, eventType: string): number {
  const stmt = db.prepare(
    "SELECT COUNT(*) as count FROM events WHERE event = ?",
  );
  const row = stmt.get(eventType) as { count: number } | null;
  return row?.count ?? 0;
}

export function avgMetric(
  db: Database,
  eventType: string,
  jsonPath: string,
): number | null {
  const stmt = db.prepare(
    `SELECT AVG(json_extract(data, ?)) as avg FROM events WHERE event = ? AND json_extract(data, ?) IS NOT NULL`,
  );
  const row = stmt.get(jsonPath, eventType, jsonPath) as { avg: number | null } | null;
  return row?.avg ?? null;
}
