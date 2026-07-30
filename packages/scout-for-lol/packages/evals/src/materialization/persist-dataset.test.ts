import { describe, expect, test } from "bun:test";

import type { MaterializedCase } from "#materialization/materialize-case.ts";
import { persistMaterializedDataset } from "#materialization/persist-dataset.ts";
import { createEvalStore } from "#server/store.ts";
import type { CaseArtifact } from "#shared/schema.ts";
import { makeCaseArtifact } from "#testing/eval-fixtures.ts";

const FIRST_ARTIFACT = makeCaseArtifact({
  matchId: "NA1_200",
  playerName: "Jerred",
  puuid: "puuid-jerred",
  championName: "Poppy",
  performanceSlice: "great",
  styleKey: "aaron",
});

const SECOND_ARTIFACT = makeCaseArtifact({
  matchId: "NA1_201",
  playerName: "Teammate",
  puuid: "puuid-teammate",
  championName: "Orianna",
  performanceSlice: "average",
  styleKey: "aaron",
});

function materializedCase(
  artifact: CaseArtifact,
  outputText: string,
): MaterializedCase {
  return {
    artifact,
    generation: {
      durationMs: 100,
      inputTokens: 400,
      model: "test-model",
      outputText,
      outputTokens: 30,
      promptRevision: `${artifact.matchId}-prompt`,
      renderedPrompts: artifact.context.renderedPrompts,
    },
  };
}

describe("persistMaterializedDataset", () => {
  test("rolls back the dataset version and earlier rows on a mid-batch failure", () => {
    const store = createEvalStore(":memory:");
    try {
      const firstCase = materializedCase(FIRST_ARTIFACT, "First output.");

      expect(() =>
        persistMaterializedDataset(
          store,
          { key: "atomic", name: "Atomic dataset" },
          [firstCase, firstCase],
        ),
      ).toThrow("UNIQUE constraint failed");
      expect(store.listDatasets()).toEqual([]);

      const retry = store.createDataset({
        key: "atomic",
        name: "Atomic dataset retry",
      });
      expect(retry.version).toBe(1);
      expect(retry.caseCount).toBe(0);
    } finally {
      store.close();
    }
  });

  test("persists every case and baseline generation on success", () => {
    const store = createEvalStore(":memory:");
    try {
      const persisted = persistMaterializedDataset(
        store,
        { key: "successful", name: "Successful dataset" },
        [
          materializedCase(FIRST_ARTIFACT, "First output."),
          materializedCase(SECOND_ARTIFACT, "Second output."),
        ],
      );

      expect(persisted.caseIds).toHaveLength(2);
      const [firstCaseId, secondCaseId] = persisted.caseIds;
      if (firstCaseId === undefined || secondCaseId === undefined) {
        throw new Error("Successful materialization did not return two cases");
      }
      expect(store.listDatasets()).toMatchObject([
        {
          id: persisted.datasetId,
          version: 1,
          caseCount: 2,
          ratedCaseCount: 0,
        },
      ]);
      expect(store.listCases(persisted.datasetId)).toMatchObject([
        { id: firstCaseId, ordinal: 0 },
        { id: secondCaseId, ordinal: 1 },
      ]);
      expect(
        store.getCaseDetail(persisted.datasetId, firstCaseId),
      ).toMatchObject({
        artifact: FIRST_ARTIFACT,
        generation: {
          outputText: "First output.",
          renderedPrompts: FIRST_ARTIFACT.context.renderedPrompts,
        },
      });
      expect(
        store.getCaseDetail(persisted.datasetId, secondCaseId),
      ).toMatchObject({
        artifact: SECOND_ARTIFACT,
        generation: {
          outputText: "Second output.",
          renderedPrompts: SECOND_ARTIFACT.context.renderedPrompts,
        },
      });
    } finally {
      store.close();
    }
  });
});
