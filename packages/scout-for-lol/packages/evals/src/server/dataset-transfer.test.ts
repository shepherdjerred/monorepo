import { describe, expect, spyOn, test } from "bun:test";

import {
  importDatasetExportFile,
  writeDatasetExportFile,
} from "#lib/dataset-transfer-cli.ts";
import {
  createDatasetExport,
  parseDatasetExport,
  serializeDatasetExport,
} from "#server/dataset-transfer.ts";
import { openEvalDatabase } from "#server/database.ts";
import { createEvalStore, EvalStore } from "#server/store.ts";
import { DatasetExportPayloadSchema } from "#shared/schema.ts";
import { makeFinalizedRatedDataset } from "#testing/eval-fixtures.ts";

function replaceExportDataset(
  value: unknown,
  dataset: {
    id: string;
    key: string;
    version: number;
  },
) {
  const parsed = parseDatasetExport(serializeDatasetExport(value));
  return createDatasetExport(
    DatasetExportPayloadSchema.parse({
      schemaVersion: parsed.schemaVersion,
      dataset: {
        ...parsed.dataset,
        ...dataset,
      },
      cases: parsed.cases,
      freshnessRatings: parsed.freshnessRatings,
    }),
  );
}

async function deleteSqliteFiles(databasePath: string): Promise<void> {
  for (const path of [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ]) {
    const file = Bun.file(path);
    if (await file.exists()) await file.delete();
  }
}

describe("dataset export and import", () => {
  test("round-trips deterministic CLI files with every rating", async () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    const outputPath = `./dataset-transfer-${crypto.randomUUID()}.json`;
    try {
      const fixture = makeFinalizedRatedDataset(source, "roundtrip");
      const unrelated = target.createDataset({
        key: "unrelated",
        name: "Unrelated",
      });
      target.addMaterializedCase({
        datasetId: unrelated.id,
        artifact: source.getCaseDetail(fixture.dataset.id, fixture.caseId)
          .artifact,
      });

      await writeDatasetExportFile(source, fixture.dataset.id, outputPath);
      const serialized = await Bun.file(outputPath).text();
      expect(serialized).toBe(
        serializeDatasetExport(source.exportDataset(fixture.dataset.id)),
      );
      await expect(
        writeDatasetExportFile(source, fixture.dataset.id, outputPath),
      ).rejects.toThrow(`Output file already exists: ${outputPath}`);

      const imported = await importDatasetExportFile(target, outputPath);
      expect(imported).toMatchObject({
        id: fixture.dataset.id,
        key: "roundtrip",
        version: 1,
        status: "finalized",
        caseCount: 1,
        ratedCaseCount: 1,
      });
      expect(serializeDatasetExport(target.exportDataset(imported.id))).toBe(
        serialized,
      );
      expect(target.getCaseDetail(imported.id, fixture.caseId)).toMatchObject({
        generation: { id: fixture.generations[1].id },
        rating: { note: "More entertaining." },
      });
      expect(target.listStyleBatch(imported.id, "aaron").rating).toEqual({
        score: 3,
        note: "Varied enough.",
      });
    } finally {
      source.close();
      target.close();
      if (await Bun.file(outputPath).exists()) {
        await Bun.file(outputPath).delete();
      }
    }
  });

  test("accepts a distinct version and rejects dataset collisions", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      source.createDataset({ key: "versioned", name: "Version 1 placeholder" });
      const fixture = makeFinalizedRatedDataset(source, "versioned");
      expect(fixture.dataset.version).toBe(2);
      target.createDataset({ key: "versioned", name: "Existing version 1" });

      const datasetExport = source.exportDataset(fixture.dataset.id);
      expect(target.importDataset(datasetExport)).toMatchObject({
        key: "versioned",
        version: 2,
      });
      expect(() => target.importDataset(datasetExport)).toThrow(
        `Dataset id ${fixture.dataset.id} already exists`,
      );

      const versionCollision = replaceExportDataset(datasetExport, {
        id: crypto.randomUUID(),
        key: "versioned",
        version: 2,
      });
      expect(() => target.importDataset(versionCollision)).toThrow(
        "Dataset versioned version 2 already exists",
      );

      const existing = target.createDataset({
        key: "existing-id",
        name: "Existing ID",
      });
      const idCollision = replaceExportDataset(datasetExport, {
        id: existing.id,
        key: "new-key",
        version: 1,
      });
      expect(() => target.importDataset(idCollision)).toThrow(
        `Dataset id ${existing.id} already exists`,
      );

      const caseCollision = replaceExportDataset(datasetExport, {
        id: crypto.randomUUID(),
        key: "case-collision",
        version: 1,
      });
      expect(() => target.importDataset(caseCollision)).toThrow(
        `Case id ${fixture.caseId} already exists`,
      );

      const generationCollisionPayload = DatasetExportPayloadSchema.parse({
        schemaVersion: datasetExport.schemaVersion,
        dataset: {
          ...datasetExport.dataset,
          id: crypto.randomUUID(),
          key: "generation-collision",
          version: 1,
        },
        cases: datasetExport.cases.map((evalCase) => ({
          ...evalCase,
          id: crypto.randomUUID(),
        })),
        // New case ids would no longer match the freshness generation-set
        // revision; this scenario exercises generation-id collision, not
        // freshness, so omit freshness ratings.
        freshnessRatings: [],
      });
      expect(() =>
        target.importDataset(createDatasetExport(generationCollisionPayload)),
      ).toThrow(`Generation id ${fixture.generations[0].id} already exists`);
    } finally {
      source.close();
      target.close();
    }
  });

  test("rejects a freshness rating bound to a different generation set", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeFinalizedRatedDataset(source, "freshness-binding");
      const datasetExport = source.exportDataset(fixture.dataset.id);
      expect(datasetExport.freshnessRatings).not.toHaveLength(0);

      // A checksum-valid export whose freshness revision no longer matches the
      // transferred generation set must be rejected, not silently re-associated
      // with outputs the reviewer never saw.
      const tampered = createDatasetExport({
        schemaVersion: datasetExport.schemaVersion,
        dataset: {
          ...datasetExport.dataset,
          id: crypto.randomUUID(),
          key: "freshness-binding-tampered",
          version: 1,
        },
        cases: datasetExport.cases,
        freshnessRatings: datasetExport.freshnessRatings.map((freshness) => ({
          ...freshness,
          generationSetRevision: "0".repeat(64),
        })),
      });
      expect(() => target.importDataset(tampered)).toThrow(
        "different generation set",
      );
    } finally {
      source.close();
      target.close();
    }
  });

  test("rejects malformed, unsupported, and corrupted exports", () => {
    const source = createEvalStore(":memory:");
    try {
      const draft = source.createDataset({
        key: "draft-export",
        name: "Draft export",
      });
      expect(() => source.exportDataset(draft.id)).toThrow(
        `Dataset ${draft.id} must be finalized before export`,
      );

      const fixture = makeFinalizedRatedDataset(source, "malformed");
      const datasetExport = source.exportDataset(fixture.dataset.id);

      expect(() => parseDatasetExport("{")).toThrow(
        "Dataset export is not valid JSON",
      );
      expect(() =>
        parseDatasetExport(
          JSON.stringify({ ...datasetExport, unexpected: true }),
        ),
      ).toThrow(/unexpected/);
      expect(() =>
        parseDatasetExport(
          JSON.stringify({ ...datasetExport, schemaVersion: 2 }),
        ),
      ).toThrow(/schemaVersion/);
      expect(() =>
        parseDatasetExport(
          JSON.stringify({
            ...datasetExport,
            dataset: { ...datasetExport.dataset, name: "Tampered" },
          }),
        ),
      ).toThrow("Dataset export checksum mismatch");

      expect(() =>
        parseDatasetExport(
          JSON.stringify({
            ...datasetExport,
            cases: datasetExport.cases.map((evalCase) => ({
              ...evalCase,
              ordinal: 1,
            })),
          }),
        ),
      ).toThrow("Case ordinal 1 must match its array position 0");
    } finally {
      source.close();
    }
  });
});

describe("dataset export snapshot", () => {
  test("keeps concurrent generation and freshness writes out", async () => {
    const databasePath = `./dataset-snapshot-${crypto.randomUUID()}.sqlite`;
    const writerDatabase = openEvalDatabase(databasePath);
    const readerDatabase = openEvalDatabase(databasePath);
    const writer = new EvalStore(writerDatabase);
    const reader = new EvalStore(readerDatabase);
    try {
      const fixture = makeFinalizedRatedDataset(writer, "snapshot");
      const artifact = writer.getCaseDetail(
        fixture.dataset.id,
        fixture.caseId,
      ).artifact;
      const originalQuery = readerDatabase.query.bind(readerDatabase);
      let didWrite = false;
      spyOn(readerDatabase, "query").mockImplementation((sql) => {
        if (!didWrite && sql.includes("FROM freshness_ratings")) {
          didWrite = true;
          writer.recordGeneration({
            caseId: fixture.caseId,
            outputText: "Concurrent generation.",
            model: "test-model",
            promptRevision: "concurrent-v3",
            renderedPrompts: artifact.context.renderedPrompts,
            durationMs: null,
            inputTokens: null,
            outputTokens: null,
          });
        }
        return originalQuery(sql);
      });

      const snapshot = reader.exportDataset(fixture.dataset.id);
      expect(didWrite).toBe(true);
      expect(snapshot.cases[0]?.generations).toHaveLength(2);
      expect(snapshot.freshnessRatings).toEqual([
        {
          styleKey: "aaron",
          generationSetRevision: expect.stringMatching(/^[\da-f]{64}$/),
          rating: { score: 3, note: "Varied enough." },
        },
      ]);

      const current = reader.exportDataset(fixture.dataset.id);
      expect(current.cases[0]?.generations).toHaveLength(3);
      expect(current.freshnessRatings).toEqual([]);
    } finally {
      reader.close();
      writer.close();
      await deleteSqliteFiles(databasePath);
    }
  });
});
