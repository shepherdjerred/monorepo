import { describe, expect, test } from "bun:test";

import { createEvalStore } from "#server/store.ts";
import { appRouter } from "#server/trpc.ts";
import { makeCaseArtifact } from "#testing/eval-fixtures.ts";

const rating = {
  anchoredness: 3,
  entertainment: 2,
  styleRecognizability: 3,
  note: "Individually rated.",
} as const;

describe("freshness tRPC boundary", () => {
  test("rejects batch reads and writes until every current generation is rated", async () => {
    const store = createEvalStore(":memory:");
    try {
      const caller = appRouter.createCaller({ store });
      const dataset = store.createDataset({
        key: "freshness-gate",
        name: "Freshness Gate",
      });
      const firstArtifact = makeCaseArtifact({
        matchId: "NA1_GATE_1",
        playerName: "First",
        puuid: "puuid-first",
        championName: "Poppy",
        performanceSlice: "great",
        styleKey: "aaron",
      });
      const first = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: firstArtifact,
      });
      const secondArtifact = makeCaseArtifact({
        matchId: "NA1_GATE_2",
        playerName: "Second",
        puuid: "puuid-second",
        championName: "Shaco",
        performanceSlice: "terrible",
        styleKey: "aaron",
      });
      const second = store.addMaterializedCase({
        datasetId: dataset.id,
        artifact: secondArtifact,
      });
      const firstGeneration = await caller.cases.recordGeneration({
        caseId: first.id,
        outputText: "First output.",
        model: "test",
        promptRevision: "first-v1",
        renderedPrompts: firstArtifact.context.renderedPrompts,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      const secondGeneration = await caller.cases.recordGeneration({
        caseId: second.id,
        outputText: "Second output.",
        model: "test",
        promptRevision: "second-v1",
        renderedPrompts: secondArtifact.context.renderedPrompts,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
      });

      await expect(
        caller.freshness.detail({
          datasetId: dataset.id,
          styleKey: "aaron",
        }),
      ).rejects.toThrow(
        "Freshness is locked until 2 current generated cases receive individual ratings",
      );
      await caller.cases.rate({
        generationId: firstGeneration.id,
        rating,
      });
      await expect(
        caller.freshness.detail({
          datasetId: dataset.id,
          styleKey: "aaron",
        }),
      ).rejects.toThrow(
        "Freshness is locked until 1 current generated case receives individual ratings",
      );
      await expect(
        caller.freshness.rate({
          datasetId: dataset.id,
          generationSetRevision: "0".repeat(64),
          styleKey: "aaron",
          rating: { score: 2, note: "Must remain blocked." },
        }),
      ).rejects.toThrow(
        "Freshness is locked until 1 current generated case receives individual ratings",
      );

      await caller.cases.rate({
        generationId: secondGeneration.id,
        rating,
      });
      const batch = await caller.freshness.detail({
        datasetId: dataset.id,
        styleKey: "aaron",
      });
      expect(batch.reviews.map((review) => review.generationId)).toEqual([
        firstGeneration.id,
        secondGeneration.id,
      ]);
      await expect(
        caller.freshness.rate({
          datasetId: dataset.id,
          generationSetRevision: batch.generationSetRevision,
          styleKey: "aaron",
          rating: { score: 3, note: "Now accepted." },
        }),
      ).resolves.toEqual({ score: 3, note: "Now accepted." });
    } finally {
      store.close();
    }
  });
});
