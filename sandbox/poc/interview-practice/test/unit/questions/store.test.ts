import { describe, test, expect } from "bun:test";
import path from "node:path";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createLogger } from "#logger";

const DATA_DIR = path.join(import.meta.dir, "../../../data/questions/leetcode");

const logger = createLogger({
  level: "error",
  sessionId: "test",
  logFilePath: "/dev/null",
  component: "test",
});

describe("question store", () => {
  test("loads questions from data directory", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const all = store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by difficulty", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const easy = store.filter({ difficulty: "easy" });
    const medium = store.filter({ difficulty: "medium" });

    for (const q of easy) {
      expect(q.difficulty).toBe("easy");
    }
    for (const q of medium) {
      expect(q.difficulty).toBe("medium");
    }
  });

  test("finds by slug", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const q = store.getBySlug("two-sum");
    expect(q).toBeDefined();
    expect(q?.title).toBe("Two Sum");
  });

  test("finds by id", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const all = store.getAll();
    if (all.length > 0) {
      const first = all[0];
      const found = store.getById(first?.id ?? "");
      expect(found).toBeDefined();
      expect(found?.id).toBe(first?.id);
    }
  });

  test("getRandom returns a question", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const q = store.getRandom();
    expect(q).toBeDefined();
  });

  test("getRandom with filter", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    const q = store.getRandom({ difficulty: "easy" });
    if (q) {
      expect(q.difficulty).toBe("easy");
    }
  });

  test("handles missing directory gracefully", async () => {
    const store = await loadQuestionStore("/nonexistent/path", logger);
    expect(store.getAll()).toHaveLength(0);
  });

  test("each question has valid parts", async () => {
    const store = await loadQuestionStore(DATA_DIR, logger);
    for (const q of store.getAll()) {
      expect(q.parts.length).toBeGreaterThanOrEqual(1);
      expect(q.parts.length).toBeLessThanOrEqual(4);
      for (const part of q.parts) {
        expect(part.testCases.length).toBeGreaterThanOrEqual(1);
        expect(part.hints.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
