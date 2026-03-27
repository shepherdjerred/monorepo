import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "#lib/db/schema.ts";
import {
  insertEvent,
  queryEvents,
  countEvents,
  avgMetric,
} from "#lib/db/events.ts";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  initializeSchema(db);
});

afterEach(() => {
  db.close();
});

describe("events", () => {
  test("insert and query events", () => {
    insertEvent(db, "turn", { latencyMs: 300, tokensIn: 100 });
    insertEvent(db, "test_run", { passed: 3, failed: 1 });

    const all = queryEvents(db);
    expect(all).toHaveLength(2);
  });

  test("filter by event type", () => {
    insertEvent(db, "turn", { latencyMs: 300 });
    insertEvent(db, "turn", { latencyMs: 400 });
    insertEvent(db, "test_run", { passed: 5 });

    const turns = queryEvents(db, "turn");
    expect(turns).toHaveLength(2);

    const tests = queryEvents(db, "test_run");
    expect(tests).toHaveLength(1);
  });

  test("count events by type", () => {
    insertEvent(db, "turn", {});
    insertEvent(db, "turn", {});
    insertEvent(db, "hint_given", {});

    expect(countEvents(db, "turn")).toBe(2);
    expect(countEvents(db, "hint_given")).toBe(1);
    expect(countEvents(db, "nonexistent")).toBe(0);
  });

  test("average metric from JSON data", () => {
    insertEvent(db, "turn", { latencyMs: 200 });
    insertEvent(db, "turn", { latencyMs: 400 });
    insertEvent(db, "turn", { latencyMs: 300 });

    const avg = avgMetric(db, "turn", "$.latencyMs");
    expect(avg).toBe(300);
  });
});
