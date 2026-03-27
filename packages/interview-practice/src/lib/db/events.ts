import type { Database } from "bun:sqlite";
import { z } from "zod/v4";

const SessionEventSchema = z.object({
  id: z.number(),
  event: z.string(),
  data: z.string().nullable(),
  timestamp: z.number(),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

function parseEventRows(rows: unknown[]): SessionEvent[] {
  return rows.map((row) => SessionEventSchema.parse(row));
}

const CountSchema = z.object({ count: z.number() });
const AvgSchema = z.object({ avg: z.number().nullable() });

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
  if (eventType !== undefined) {
    const stmt = db.prepare(
      "SELECT id, event, data, timestamp FROM events WHERE event = ? ORDER BY id DESC LIMIT ?",
    );
    return parseEventRows(stmt.all(eventType, limit));
  }
  const stmt = db.prepare(
    "SELECT id, event, data, timestamp FROM events ORDER BY id DESC LIMIT ?",
  );
  return parseEventRows(stmt.all(limit));
}

export function countEvents(db: Database, eventType: string): number {
  const stmt = db.prepare(
    "SELECT COUNT(*) as count FROM events WHERE event = ?",
  );
  const raw = stmt.get(eventType);
  if (raw == null) return 0;
  const row = CountSchema.parse(raw);
  return row.count;
}

export function avgMetric(
  db: Database,
  eventType: string,
  jsonPath: string,
): number | null {
  const stmt = db.prepare(
    `SELECT AVG(json_extract(data, ?)) as avg FROM events WHERE event = ? AND json_extract(data, ?) IS NOT NULL`,
  );
  const raw = stmt.get(jsonPath, eventType, jsonPath);
  if (raw == null) return null;
  const row = AvgSchema.parse(raw);
  return row.avg;
}
