import { describe, expect, test } from "bun:test";

import { createEvalStore } from "#server/store.ts";
import { appRouter } from "#server/trpc.ts";
import {
  makeDraftDataset,
  makeFinalizedRatedDataset,
} from "#testing/eval-fixtures.ts";

describe("dataset transfer tRPC API", () => {
  test("exports and imports through validated procedures", async () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeFinalizedRatedDataset(source, "api-transfer");
      const sourceCaller = appRouter.createCaller({ store: source });
      const targetCaller = appRouter.createCaller({ store: target });

      const datasetExport = await sourceCaller.datasets.export({
        datasetId: fixture.dataset.id,
      });
      const imported = await targetCaller.datasets.import(datasetExport);

      expect(imported).toMatchObject({
        id: fixture.dataset.id,
        key: "api-transfer",
        status: "finalized",
      });
      expect(
        await targetCaller.datasets.export({ datasetId: imported.id }),
      ).toEqual(datasetExport);
      await expect(
        targetCaller.datasets.import({
          ...datasetExport,
          sha256: "0".repeat(64),
        }),
      ).rejects.toThrow("Dataset export checksum mismatch");
    } finally {
      source.close();
      target.close();
    }
  });

  test("pushes drafts through the validated pushDraft procedure", async () => {
    const source = createEvalStore(":memory:");
    const target = createEvalStore(":memory:");
    try {
      const fixture = makeDraftDataset(source, "api-draft-push");
      const targetCaller = appRouter.createCaller({ store: target });

      const transfer = source.exportDraft(fixture.datasetId);
      const pushed = await targetCaller.datasets.pushDraft(transfer);
      expect(pushed).toMatchObject({
        id: fixture.datasetId,
        key: "api-draft-push",
        status: "draft",
        caseCount: 1,
      });
      expect(target.exportDraft(fixture.datasetId)).toEqual(transfer);

      await expect(
        targetCaller.datasets.pushDraft({
          ...transfer,
          sha256: "0".repeat(64),
        }),
      ).rejects.toThrow("Draft transfer checksum mismatch");
    } finally {
      source.close();
      target.close();
    }
  });
});
