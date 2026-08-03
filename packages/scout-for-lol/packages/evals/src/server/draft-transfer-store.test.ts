import { describe, expect, test } from "bun:test";

import { createDraftTransfer } from "#server/dataset-transfer.ts";
import { createEvalStore, type EvalStore } from "#server/store.ts";
import { DatasetDraftTransferPayloadSchema } from "#shared/schema.ts";
import {
  makeCaseArtifact,
  makeDraftDataset,
  makeFinalizedRatedDataset,
} from "#testing/eval-fixtures.ts";

function extendDraft(store: EvalStore, datasetId: string, suffix: string) {
  const artifact = makeCaseArtifact({
    matchId: `NA1_extension_${suffix}`,
    playerName: "Aaron",
    puuid: `puuid-extension-${suffix}`,
    championName: "Teemo",
    performanceSlice: "terrible",
    styleKey: "nekoryan",
  });
  const evalCase = store.addMaterializedCase({ datasetId, artifact });
  const generation = store.recordGeneration({
    caseId: evalCase.id,
    outputText: `Extension output ${suffix}.`,
    model: "test-model",
    promptRevision: "baseline-v1",
    renderedPrompts: artifact.context.renderedPrompts,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
  });
  return { evalCase, generation };
}

describe("draft transfer store", () => {
  test("round-trips a draft and re-exports it byte-identically", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-roundtrip");
      const transfer = source.exportDraft(fixture.datasetId);

      const summary = target.pushDraft(transfer);
      expect(summary).toMatchObject({
        id: fixture.datasetId,
        key: "draft-roundtrip",
        version: 1,
        status: "draft",
        caseCount: 1,
        ratedCaseCount: 0,
      });
      expect(target.exportDraft(fixture.datasetId)).toEqual(transfer);
      expect(
        target.getCaseDetail(fixture.datasetId, fixture.caseId).generation,
      ).toEqual(fixture.generation);
    } finally {
      source.close();
      target.close();
    }
  });

  test("re-push is idempotent and additive", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-additive");
      target.pushDraft(source.exportDraft(fixture.datasetId));

      // Identical re-push changes nothing.
      expect(
        target.pushDraft(source.exportDraft(fixture.datasetId)),
      ).toMatchObject({ caseCount: 1 });

      // A rating authored on the target survives later pushes.
      target.upsertHumanRating({
        generationId: fixture.generation.id,
        rating: {
          anchoredness: 3,
          entertainment: 2,
          styleRecognizability: 3,
          note: "Rated on the hosted instance.",
        },
      });

      const extension = extendDraft(source, fixture.datasetId, "one");
      const extended = target.pushDraft(source.exportDraft(fixture.datasetId));
      expect(extended).toMatchObject({ caseCount: 2, ratedCaseCount: 1 });
      expect(
        target.getCaseDetail(fixture.datasetId, extension.evalCase.id)
          .generation,
      ).toEqual(extension.generation);
      expect(
        target.getCaseDetail(fixture.datasetId, fixture.caseId).rating,
      ).toMatchObject({ note: "Rated on the hosted instance." });
    } finally {
      source.close();
      target.close();
    }
  });

  test("a new generation invalidates the target freshness rating for its style", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-freshness");
      target.pushDraft(source.exportDraft(fixture.datasetId));

      // Freshness unlocks only after every generated case has its own rating.
      target.upsertHumanRating({
        generationId: fixture.generation.id,
        rating: {
          anchoredness: 3,
          entertainment: 3,
          styleRecognizability: 3,
          note: "Baseline rating.",
        },
      });
      const batch = target.listStyleBatch(fixture.datasetId, "aaron");
      target.upsertFreshnessRating({
        datasetId: fixture.datasetId,
        styleKey: "aaron",
        generationSetRevision: batch.generationSetRevision,
        rating: { score: 3, note: "Fresh enough." },
      });

      // Pushing a new generation for the rated style drops the stale rating.
      const secondGeneration = source.recordGeneration({
        caseId: fixture.caseId,
        outputText: "Second local generation.",
        model: "test-model",
        promptRevision: "candidate-v2",
        renderedPrompts: fixture.generation.renderedPrompts,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      target.pushDraft(source.exportDraft(fixture.datasetId));
      // Rate the newly pushed latest generation so freshness unlocks again,
      // then confirm the pre-push freshness rating was invalidated.
      target.upsertHumanRating({
        generationId: secondGeneration.id,
        rating: {
          anchoredness: 2,
          entertainment: 2,
          styleRecognizability: 2,
          note: "Rating the pushed generation.",
        },
      });
      expect(target.listStyleBatch(fixture.datasetId, "aaron").rating).toBe(
        null,
      );
    } finally {
      source.close();
      target.close();
    }
  });
});

describe("draft transfer store rejections", () => {
  test("rejects tampered checksums and payload mutations", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-tamper");
      const transfer = source.exportDraft(fixture.datasetId);
      expect(() => {
        target.pushDraft({ ...transfer, sha256: "0".repeat(64) });
      }).toThrow("Draft transfer checksum mismatch");
      expect(() => {
        target.pushDraft({
          ...transfer,
          dataset: { ...transfer.dataset, name: "Renamed" },
        });
      }).toThrow("Draft transfer checksum mismatch");
    } finally {
      source.close();
      target.close();
    }
  });

  test("rejects pushes onto a finalized dataset", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-finalized");
      const transfer = source.exportDraft(fixture.datasetId);
      target.pushDraft(transfer);
      target.finalizeDataset(fixture.datasetId, 1);
      expect(() => target.pushDraft(transfer)).toThrow(
        `Dataset ${fixture.datasetId} is finalized and cannot accept draft pushes`,
      );
    } finally {
      source.close();
      target.close();
    }
  });

  test("rejects content drift on existing records instead of overwriting", () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-drift");
      const transfer = source.exportDraft(fixture.datasetId);
      target.pushDraft(transfer);

      const [onlyCase] = transfer.cases;
      if (onlyCase === undefined) throw new Error("Fixture case missing");
      const [onlyGeneration] = onlyCase.generations;
      if (onlyGeneration === undefined) {
        throw new Error("Fixture generation missing");
      }

      const driftedGeneration = createDraftTransfer(
        DatasetDraftTransferPayloadSchema.parse({
          schemaVersion: 1,
          dataset: transfer.dataset,
          cases: [
            {
              ...onlyCase,
              generations: [
                { ...onlyGeneration, outputText: "Rewritten output." },
              ],
            },
          ],
        }),
      );
      expect(() => target.pushDraft(driftedGeneration)).toThrow(
        `Generation ${onlyGeneration.id} already exists with different content`,
      );

      const driftedMetadata = createDraftTransfer(
        DatasetDraftTransferPayloadSchema.parse({
          schemaVersion: 1,
          dataset: { ...transfer.dataset, description: "Rewritten" },
          cases: transfer.cases,
        }),
      );
      expect(() => target.pushDraft(driftedMetadata)).toThrow(
        `Dataset ${transfer.dataset.id} already exists with different metadata`,
      );
    } finally {
      source.close();
      target.close();
    }
  });

  test("rejects id collisions across datasets and key/version collisions", () => {
    const source = createEvalStore(":memory:");
    const other = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "draft-collision");
      const transfer = source.exportDraft(fixture.datasetId);
      target.pushDraft(transfer);

      // Same case id under a different dataset id.
      const otherFixture = makeDraftDataset(other, "draft-collision-other");
      const otherTransfer = other.exportDraft(otherFixture.datasetId);
      const [stolenCase] = transfer.cases;
      if (stolenCase === undefined) throw new Error("Fixture case missing");
      const caseCollision = createDraftTransfer(
        DatasetDraftTransferPayloadSchema.parse({
          schemaVersion: 1,
          dataset: otherTransfer.dataset,
          cases: [{ ...stolenCase, generations: [] }],
        }),
      );
      expect(() => target.pushDraft(caseCollision)).toThrow(
        `Case ${stolenCase.id} already belongs to dataset ${fixture.datasetId}`,
      );

      // Same key+version under a different dataset id.
      const keyCollision = createDraftTransfer(
        DatasetDraftTransferPayloadSchema.parse({
          schemaVersion: 1,
          dataset: { ...otherTransfer.dataset, key: "draft-collision" },
          cases: otherTransfer.cases,
        }),
      );
      expect(() => target.pushDraft(keyCollision)).toThrow(
        "Dataset draft-collision version 1 already exists as " +
          fixture.datasetId,
      );
    } finally {
      source.close();
      other.close();
      target.close();
    }
  });

  test("only exports drafts with cases", () => {
    const store = createEvalStore(":memory:");
    try {
      const finalized = makeFinalizedRatedDataset(store, "draft-export-guard");
      expect(() => store.exportDraft(finalized.dataset.id)).toThrow(
        `Dataset ${finalized.dataset.id} must be a draft to transfer drafts`,
      );

      const empty = store.createDataset({
        key: "draft-empty",
        name: "Empty draft",
      });
      expect(() => store.exportDraft(empty.id)).toThrow(
        `Draft dataset ${empty.id} has no cases to transfer`,
      );
    } finally {
      store.close();
    }
  });
});
