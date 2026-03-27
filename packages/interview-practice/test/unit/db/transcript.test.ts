import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeSchema } from "#lib/db/schema.ts";
import {
  insertTranscript,
  getTranscriptWindow,
  getAllTranscript,
  searchTranscript,
} from "#lib/db/transcript.ts";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  initializeSchema(db);
});

afterEach(() => {
  db.close();
});

describe("transcript", () => {
  test("insert and retrieve entries", () => {
    insertTranscript(db, "user", "Hello");
    insertTranscript(db, "interviewer", "Hi there");

    const all = getAllTranscript(db);
    expect(all).toHaveLength(2);
    expect(all[0]?.role).toBe("user");
    expect(all[0]?.content).toBe("Hello");
    expect(all[1]?.role).toBe("interviewer");
  });

  test("getTranscriptWindow returns latest N entries in order", () => {
    for (let i = 0; i < 10; i++) {
      insertTranscript(db, "user", `message ${String(i)}`);
    }

    const window = getTranscriptWindow(db, 3);
    expect(window).toHaveLength(3);
    expect(window[0]?.content).toBe("message 7");
    expect(window[2]?.content).toBe("message 9");
  });

  test("stores metadata as JSON", () => {
    insertTranscript(db, "interviewer", "test", {
      tokensIn: 100,
      latencyMs: 200,
    });

    const all = getAllTranscript(db);
    expect(all).toHaveLength(1);
    const meta = JSON.parse(all[0]?.metadata ?? "{}") as Record<string, unknown>;
    expect(meta["tokensIn"]).toBe(100);
  });

  test("FTS search finds matching content", () => {
    insertTranscript(db, "user", "I will use a hash map approach");
    insertTranscript(db, "user", "binary search tree");
    insertTranscript(db, "interviewer", "Good approach");

    const results = searchTranscript(db, "hash map");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.content).toContain("hash map");
  });

  test("handles empty database", () => {
    const all = getAllTranscript(db);
    expect(all).toHaveLength(0);

    const window = getTranscriptWindow(db, 10);
    expect(window).toHaveLength(0);
  });
});
