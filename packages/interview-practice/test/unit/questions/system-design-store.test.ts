import { describe, test, expect } from "bun:test";
import path from "node:path";
import { loadSystemDesignQuestionStore } from "#lib/questions/store.ts";
import { SystemDesignQuestionSchema } from "#lib/questions/schemas.ts";
import { createLogger } from "#logger";

const DATA_DIR = path.join(
  import.meta.dir,
  "../../../data/questions/system-design",
);

const logger = createLogger({
  level: "error",
  sessionId: "test",
  logFilePath: "/dev/null",
  component: "test",
});

describe("system design question store", () => {
  test("loads questions from data directory", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const all = store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  test("filters by difficulty", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const mid = store.filter({ difficulty: "mid" });
    const senior = store.filter({ difficulty: "senior" });

    for (const q of mid) {
      expect(q.difficulty).toBe("mid");
    }
    for (const q of senior) {
      expect(q.difficulty).toBe("senior");
    }
    expect(mid.length).toBeGreaterThan(0);
    expect(senior.length).toBeGreaterThan(0);
  });

  test("filters by category", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const distributed = store.filter({ category: "distributed-systems" });
    expect(distributed.length).toBeGreaterThan(0);
    for (const q of distributed) {
      expect(q.category).toBe("distributed-systems");
    }
  });

  test("finds by slug", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const q = store.getBySlug("url-shortener");
    expect(q).toBeDefined();
    expect(q?.title).toBe("URL Shortener");
  });

  test("finds by id", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const all = store.getAll();
    if (all.length > 0) {
      const first = all[0];
      const found = store.getById(first?.id ?? "");
      expect(found).toBeDefined();
      expect(found?.id).toBe(first?.id);
    }
  });

  test("getRandom returns a question", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const q = store.getRandom();
    expect(q).toBeDefined();
  });

  test("getRandom with filter", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    const q = store.getRandom({ difficulty: "mid" });
    if (q) {
      expect(q.difficulty).toBe("mid");
    }
  });

  test("handles missing directory gracefully", async () => {
    const store = await loadSystemDesignQuestionStore(
      "/nonexistent/path",
      logger,
    );
    expect(store.getAll()).toHaveLength(0);
  });

  test("each question has valid rubric with scoring anchors", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    for (const q of store.getAll()) {
      expect(q.rubric.requirementGathering.anchors[1]).toBeDefined();
      expect(q.rubric.requirementGathering.anchors[4]).toBeDefined();
      expect(q.rubric.highLevelDesign.anchors[1]).toBeDefined();
      expect(q.rubric.deepDive.anchors[1]).toBeDefined();
      expect(q.rubric.tradeoffs.anchors[1]).toBeDefined();
      expect(q.commonMistakes.length).toBeGreaterThan(0);
    }
  });

  test("each question has all phase definitions", async () => {
    const store = await loadSystemDesignQuestionStore(DATA_DIR, logger);
    for (const q of store.getAll()) {
      expect(q.phases.requirements.keyQuestions.length).toBeGreaterThan(0);
      expect(q.phases.estimation.keyCalculations.length).toBeGreaterThan(0);
      expect(q.phases.apiDesign.expectedEndpoints.length).toBeGreaterThan(0);
      expect(q.phases.dataModel.expectedEntities.length).toBeGreaterThan(0);
      expect(q.phases.highLevel.expectedComponents.length).toBeGreaterThan(0);
      expect(q.phases.deepDive.suggestedTopics.length).toBeGreaterThan(0);
      expect(q.phases.requirements.timeTarget).toBeGreaterThan(0);
    }
  });
});

describe("SystemDesignQuestionSchema", () => {
  test("validates a well-formed question", () => {
    const q = {
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Test System",
      slug: "test-system",
      category: "distributed-systems",
      difficulty: "mid",
      prompt: "Design a test system",
      requirements: {
        functional: ["Feature A"],
        nonFunctional: ["Low latency"],
        scale: { users: "1M" },
      },
      phases: {
        requirements: { keyQuestions: ["Q1"], timeTarget: 5 },
        estimation: { keyCalculations: ["Calc1"], timeTarget: 4 },
        apiDesign: { expectedEndpoints: ["GET /api"], timeTarget: 5 },
        dataModel: { expectedEntities: ["users"], timeTarget: 5 },
        highLevel: { expectedComponents: ["LB"], timeTarget: 10 },
        deepDive: { suggestedTopics: ["Caching"], timeTarget: 12 },
      },
      rubric: {
        requirementGathering: {
          checklist: ["Item 1"],
          anchors: { 1: "Bad", 2: "OK", 3: "Good", 4: "Great" },
        },
        highLevelDesign: {
          checklist: ["Item 1"],
          anchors: { 1: "Bad", 2: "OK", 3: "Good", 4: "Great" },
        },
        deepDive: {
          checklist: ["Item 1"],
          anchors: { 1: "Bad", 2: "OK", 3: "Good", 4: "Great" },
        },
        tradeoffs: {
          checklist: ["Item 1"],
          anchors: { 1: "Bad", 2: "OK", 3: "Good", 4: "Great" },
        },
      },
      commonMistakes: ["Mistake 1"],
      source: "Test",
    };

    const result = SystemDesignQuestionSchema.safeParse(q);
    expect(result.success).toBe(true);
  });

  test("rejects invalid category", () => {
    const q = {
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Test",
      slug: "test",
      category: "invalid-category",
      difficulty: "mid",
      prompt: "Design something",
      requirements: {
        functional: [],
        nonFunctional: [],
        scale: {},
      },
      phases: {
        requirements: { keyQuestions: [], timeTarget: 5 },
        estimation: { keyCalculations: [], timeTarget: 4 },
        apiDesign: { expectedEndpoints: [], timeTarget: 5 },
        dataModel: { expectedEntities: [], timeTarget: 5 },
        highLevel: { expectedComponents: [], timeTarget: 10 },
        deepDive: { suggestedTopics: [], timeTarget: 12 },
      },
      rubric: {
        requirementGathering: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        highLevelDesign: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        deepDive: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        tradeoffs: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
      },
      commonMistakes: [],
      source: "Test",
    };

    const result = SystemDesignQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
  });

  test("rejects invalid difficulty", () => {
    const q = {
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Test",
      slug: "test",
      category: "distributed-systems",
      difficulty: "easy",
      prompt: "Design something",
      requirements: {
        functional: [],
        nonFunctional: [],
        scale: {},
      },
      phases: {
        requirements: { keyQuestions: [], timeTarget: 5 },
        estimation: { keyCalculations: [], timeTarget: 4 },
        apiDesign: { expectedEndpoints: [], timeTarget: 5 },
        dataModel: { expectedEntities: [], timeTarget: 5 },
        highLevel: { expectedComponents: [], timeTarget: 10 },
        deepDive: { suggestedTopics: [], timeTarget: 12 },
      },
      rubric: {
        requirementGathering: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        highLevelDesign: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        deepDive: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
        tradeoffs: {
          checklist: [],
          anchors: { 1: "a", 2: "b", 3: "c", 4: "d" },
        },
      },
      commonMistakes: [],
      source: "Test",
    };

    const result = SystemDesignQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
  });
});
