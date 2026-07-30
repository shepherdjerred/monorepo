import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { openEvalDatabase } from "#server/database.ts";
import { applyMigrations, MIGRATIONS } from "#server/migrations.ts";
import { createEvalStore, EvalStore } from "#server/store.ts";
import { makeCaseArtifact } from "#testing/eval-fixtures.ts";

const SqliteConfigRowSchema = z.strictObject({
  foreignKeys: z.literal(1),
  busyTimeout: z.literal(5000),
});

const MigrationRowSchema = z.strictObject({
  version: z.number().int().positive(),
  name: z.string().min(1),
});

const CountRowSchema = z.strictObject({
  count: z.number().int().nonnegative(),
});

const FIRST_ARTIFACT = makeCaseArtifact({
  matchId: "NA1_100",
  playerName: "Jerred",
  puuid: "puuid-jerred",
  championName: "Poppy",
  performanceSlice: "great",
  styleKey: "aaron",
});

const SECOND_ARTIFACT = makeCaseArtifact({
  matchId: "NA1_101",
  playerName: "Ryan",
  puuid: "puuid-ryan",
  championName: "Shaco",
  performanceSlice: "terrible",
  styleKey: "aaron",
});

describe("SQLite setup and migrations", () => {
  test("enables connection safety pragmas and applies ordered migrations once", () => {
    const database = openEvalDatabase(":memory:");
    try {
      const foreignKeys = z
        .strictObject({ foreignKeys: z.literal(1) })
        .parse(
          database
            .query(
              "SELECT foreign_keys AS foreignKeys FROM pragma_foreign_keys()",
            )
            .get(),
        );
      const busyTimeout = z
        .strictObject({ busyTimeout: z.literal(5000) })
        .parse(
          database
            .query("SELECT timeout AS busyTimeout FROM pragma_busy_timeout()")
            .get(),
        );
      expect(
        SqliteConfigRowSchema.parse({
          ...foreignKeys,
          ...busyTimeout,
        }),
      ).toEqual({ foreignKeys: 1, busyTimeout: 5000 });

      applyMigrations(database);
      const rows = z
        .array(MigrationRowSchema)
        .parse(
          database
            .query(
              "SELECT version, name FROM schema_migrations ORDER BY version",
            )
            .all(),
        );
      expect(rows).toEqual(
        MIGRATIONS.map((migration) => ({
          version: migration.version,
          name: migration.name,
        })),
      );
    } finally {
      database.close();
    }
  });

  test("rejects an unknown migration ledger entry", () => {
    const database = openEvalDatabase(":memory:");
    try {
      database
        .query(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(999, "future", new Date().toISOString());
      expect(() => applyMigrations(database)).toThrow(
        "Database has unknown migration 999",
      );
    } finally {
      database.close();
    }
  });
});

describe("EvalStore datasets and cases", () => {
  test("versions datasets by key and reports case progress", () => {
    const store = createEvalStore(":memory:");
    try {
      const first = store.createDataset({
        key: "calibration",
        name: "Calibration v1",
      });
      const second = store.createDataset({
        key: "calibration",
        name: "Calibration v2",
        description: "Second pass",
      });
      const other = store.createDataset({ key: "holdout", name: "Holdout" });

      expect(first.version).toBe(1);
      expect(second.version).toBe(2);
      expect(other.version).toBe(1);
      expect(store.listDatasets()).toHaveLength(3);
      expect(first).toMatchObject({
        status: "draft",
        caseCount: 0,
        ratedCaseCount: 0,
        finalizedAt: null,
      });

      store.addMaterializedCase({
        datasetId: first.id,
        artifact: FIRST_ARTIFACT,
      });
      expect(
        store.listDatasets().find((dataset) => dataset.id === first.id),
      ).toMatchObject({ caseCount: 1, ratedCaseCount: 0 });
    } finally {
      store.close();
    }
  });

  test("orders cases and returns artifact navigation and empty generation state", () => {
    const store = createEvalStore(":memory:");
    try {
      const dataset = store.createDataset({ key: "nav", name: "Navigation" });
      const first = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      const second = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: SECOND_ARTIFACT,
      });

      expect(store.listCases(dataset.id)).toMatchObject([
        { id: first.id, ordinal: 0, generationId: null, isRated: false },
        { id: second.id, ordinal: 1, generationId: null, isRated: false },
      ]);
      expect(store.getCaseDetail(dataset.id, first.id)).toMatchObject({
        artifact: FIRST_ARTIFACT,
        generation: null,
        rating: null,
        previousCaseId: null,
        nextCaseId: second.id,
      });
      expect(store.getCaseDetail(dataset.id, second.id)).toMatchObject({
        previousCaseId: first.id,
        nextCaseId: null,
      });
      const otherDataset = store.createDataset({
        key: "other-navigation",
        name: "Other Navigation",
      });
      expect(() => store.getCaseDetail(otherDataset.id, first.id)).toThrow(
        "does not belong",
      );
    } finally {
      store.close();
    }
  });

  test("freezes finalized dataset metadata, membership, and artifacts", () => {
    const database = openEvalDatabase(":memory:");
    const store = new EvalStore(database);
    try {
      const dataset = store.createDataset({ key: "frozen", name: "Frozen" });
      const evalCase = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      const finalized = store.finalizeDataset(dataset.id);

      expect(finalized.status).toBe("finalized");
      expect(finalized.finalizedAt).not.toBeNull();
      expect(
        store.getCaseDetail(dataset.id, evalCase.id).artifact.context
          .renderedPrompts,
      ).toEqual(FIRST_ARTIFACT.context.renderedPrompts);
      expect(() => store.finalizeDataset(dataset.id)).toThrow(
        "already finalized",
      );
      expect(() =>
        store.addMaterializedCase({
          datasetId: dataset.id,
          artifact: SECOND_ARTIFACT,
        }),
      ).toThrow("cannot add a case to a finalized dataset");
      expect(() =>
        database
          .query("UPDATE dataset_cases SET champion_name = ? WHERE id = ?")
          .run("Teemo", evalCase.id),
      ).toThrow("finalized dataset case is immutable");
      expect(() =>
        database.query("DELETE FROM datasets WHERE id = ?").run(dataset.id),
      ).toThrow("finalized dataset is immutable");

      const draft = store.createDataset({ key: "draft", name: "Draft" });
      const draftCase = store.addMaterializedCase({
        datasetId: draft.id,
        artifact: SECOND_ARTIFACT,
      });
      expect(() =>
        database
          .query("UPDATE dataset_cases SET dataset_id = ? WHERE id = ?")
          .run(dataset.id, draftCase.id),
      ).toThrow("finalized dataset case is immutable");
    } finally {
      store.close();
    }
  });

  test("rejects finalizing an empty dataset", () => {
    const store = createEvalStore(":memory:");
    try {
      const dataset = store.createDataset({ key: "empty", name: "Empty" });

      expect(() => store.finalizeDataset(dataset.id)).toThrow(
        `Cannot finalize empty dataset ${dataset.id}`,
      );
      expect(store.listDatasets()).toMatchObject([{ status: "draft" }]);
    } finally {
      store.close();
    }
  });

  test("rejects duplicate materialized match-player-style membership", () => {
    const store = createEvalStore(":memory:");
    try {
      const dataset = store.createDataset({ key: "unique", name: "Unique" });
      store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      expect(() =>
        store.addMaterializedCase({
          datasetId: dataset.id,
          artifact: FIRST_ARTIFACT,
        }),
      ).toThrow("UNIQUE constraint failed");
    } finally {
      store.close();
    }
  });
});

describe("EvalStore generations and ratings", () => {
  test("appends generations after finalization and rates only the latest output", () => {
    const store = createEvalStore(":memory:");
    try {
      const dataset = store.createDataset({ key: "ratings", name: "Ratings" });
      const evalCase = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      store.finalizeDataset(dataset.id);

      const firstGeneration = store.recordGeneration({
        caseId: evalCase.id,
        outputText: "Poppy built a wall and invoiced the enemy team for it.",
        model: "test-model",
        promptRevision: "baseline-v1",
        durationMs: 120,
        inputTokens: 400,
        outputTokens: 30,
      });
      const firstRating = store.upsertHumanRating({
        generationId: firstGeneration.id,
        rating: {
          anchoredness: 3,
          entertainment: 2,
          styleRecognizability: 2,
          note: "Specific but restrained.",
        },
      });
      expect(firstRating.anchoredness).toBe(3);
      expect(store.getCaseDetail(dataset.id, evalCase.id).rating).toEqual(
        firstRating,
      );
      expect(store.listDatasets()[0]?.ratedCaseCount).toBe(1);

      const secondGeneration = store.recordGeneration({
        caseId: evalCase.id,
        outputText: "Ten kills on Poppy: traffic laws have been abolished.",
        model: "test-model-2",
        promptRevision: "candidate-v2",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      expect(store.getCaseDetail(dataset.id, evalCase.id)).toMatchObject({
        generation: { id: secondGeneration.id },
        rating: null,
        summary: { generationId: secondGeneration.id, isRated: false },
      });
      expect(store.listDatasets()[0]?.ratedCaseCount).toBe(0);

      const edited = store.upsertHumanRating({
        generationId: secondGeneration.id,
        rating: {
          anchoredness: 3,
          entertainment: 3,
          styleRecognizability: 3,
          note: "Strong candidate.",
        },
      });
      const reedited = store.upsertHumanRating({
        generationId: secondGeneration.id,
        rating: { ...edited, entertainment: 2, note: "Funny, not perfect." },
      });
      expect(store.getCaseDetail(dataset.id, evalCase.id).rating).toEqual(
        reedited,
      );
      expect(store.listCases(dataset.id)[0]?.isRated).toBe(true);
    } finally {
      store.close();
    }
  });

  test("enforces rating constraints and immutable generations in SQL", () => {
    const database = openEvalDatabase(":memory:");
    const store = new EvalStore(database);
    try {
      const dataset = store.createDataset({ key: "strict", name: "Strict" });
      const evalCase = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      const generation = store.recordGeneration({
        caseId: evalCase.id,
        outputText: "A generated review.",
        model: "test-model",
        promptRevision: "v1",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });

      expect(() =>
        database
          .query(
            `INSERT INTO human_ratings (
               generation_id, anchoredness, entertainment,
               style_recognizability, note, created_at, updated_at
             ) VALUES (?, 4, 2, 2, '', ?, ?)`,
          )
          .run(
            generation.id,
            new Date().toISOString(),
            new Date().toISOString(),
          ),
      ).toThrow("CHECK constraint failed");
      expect(() =>
        database
          .query("UPDATE generations SET output_text = ? WHERE id = ?")
          .run("Changed", generation.id),
      ).toThrow("generation is immutable");
    } finally {
      store.close();
    }
  });
});

describe("EvalStore freshness ratings and row validation", () => {
  test("lists the latest generated style batch and edits one freshness rating", () => {
    const database = openEvalDatabase(":memory:");
    const store = new EvalStore(database);
    try {
      const dataset = store.createDataset({ key: "fresh", name: "Freshness" });
      const first = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      const second = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: SECOND_ARTIFACT,
      });
      store.recordGeneration({
        caseId: first.id,
        outputText: "Old first output.",
        model: "test",
        promptRevision: "v1",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      store.recordGeneration({
        caseId: first.id,
        outputText: "Latest first output.",
        model: "test",
        promptRevision: "v2",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      store.recordGeneration({
        caseId: second.id,
        outputText: "Second output.",
        model: "test",
        promptRevision: "v1",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });

      expect(() => store.listStyleBatch(dataset.id, "missing-style")).toThrow(
        "no generated reviews",
      );
      expect(() =>
        store.upsertFreshnessRating({
          datasetId: dataset.id,
          styleKey: "missing-style",
          rating: { score: 2, note: "Should not be stored." },
        }),
      ).toThrow("no generated reviews");

      expect(store.listStyleBatch(dataset.id, "aaron")).toMatchObject({
        datasetId: dataset.id,
        styleKey: "aaron",
        reviews: [
          { caseId: first.id, outputText: "Latest first output." },
          { caseId: second.id, outputText: "Second output." },
        ],
        rating: null,
      });
      store.upsertFreshnessRating({
        datasetId: dataset.id,
        styleKey: "aaron",
        rating: { score: 2, note: "Some repetition." },
      });
      const edited = store.upsertFreshnessRating({
        datasetId: dataset.id,
        styleKey: "aaron",
        rating: { score: 3, note: "Varied after another read." },
      });
      expect(store.listStyleBatch(dataset.id, "aaron").rating).toEqual(edited);

      store.recordGeneration({
        caseId: first.id,
        outputText: "Newest first output.",
        model: "test",
        promptRevision: "v3",
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      expect(store.listStyleBatch(dataset.id, "aaron")).toMatchObject({
        reviews: [
          { caseId: first.id, outputText: "Newest first output." },
          { caseId: second.id, outputText: "Second output." },
        ],
        rating: null,
      });

      const count = CountRowSchema.parse(
        database
          .query(
            `SELECT COUNT(*) AS count
             FROM freshness_ratings
             WHERE dataset_id = ? AND style_key = ?`,
          )
          .get(dataset.id, "aaron"),
      );
      expect(count.count).toBe(0);
    } finally {
      store.close();
    }
  });

  test("fails loudly when a stored artifact does not match the shared contract", () => {
    const database = openEvalDatabase(":memory:");
    const store = new EvalStore(database);
    try {
      const dataset = store.createDataset({ key: "parse", name: "Parse" });
      const evalCase = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: FIRST_ARTIFACT,
      });
      database
        .query("UPDATE dataset_cases SET artifact_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...FIRST_ARTIFACT, context: {} }), evalCase.id);

      expect(() => store.getCaseDetail(dataset.id, evalCase.id)).toThrow();
    } finally {
      store.close();
    }
  });

  test("close releases the SQLite connection", () => {
    const store = createEvalStore(":memory:");
    store.close();
    expect(() => store.listDatasets()).toThrow();
  });
});
