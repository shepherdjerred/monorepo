import { describe, expect, test } from "bun:test";

import {
  materializationDatasetTarget,
  MaterializationSpecSchema,
} from "#materialization/spec.ts";

function validSpec() {
  return {
    bucket: "scout-beta",
    cases: [
      {
        matchKey: "games/2026/07/28/NA1_123/match.json",
        patchContext: "Patch 26.15",
        performanceSlice: "great",
        playerHistory: "Recent games",
        selectedBehaviors: ["Use one frozen joke behavior"],
        styleKey: "aaron",
        targetPlayerId: 12,
        targetPlayerPuuid: "p".repeat(78),
        timelineKey: "games/2026/07/28/NA1_123/timeline.json",
      },
    ],
    dataset: {
      description: "Human-approved calibration cases",
      key: "cal",
      name: "Calibration 20",
    },
  };
}

describe("MaterializationSpecSchema", () => {
  test("accepts explicit match-player-style cases", () => {
    const parsed = MaterializationSpecSchema.parse(validSpec());

    expect(parsed.cases[0]).toMatchObject({
      performanceSlice: "great",
      styleKey: "aaron",
      targetPlayerId: 12,
      targetPlayerPuuid: "p".repeat(78),
    });
  });

  test("targets an existing UI-created draft by dataset ID", () => {
    const spec = validSpec();
    const datasetId = "ui-created-dataset-id";
    const parsed = MaterializationSpecSchema.parse({
      bucket: spec.bucket,
      cases: spec.cases,
      datasetId,
    });

    expect(materializationDatasetTarget(parsed)).toEqual({ datasetId });
  });

  test("requires exactly one new or existing dataset target", () => {
    const spec = validSpec();

    expect(
      MaterializationSpecSchema.safeParse({
        ...spec,
        datasetId: "ambiguous-dataset-id",
      }).success,
    ).toBe(false);
    const { dataset: omittedDataset, ...missingTarget } = spec;
    expect(omittedDataset).toBeDefined();
    expect(MaterializationSpecSchema.safeParse(missingTarget).success).toBe(
      false,
    );
  });

  test("rejects personalities outside the calibration set", () => {
    const spec = validSpec();
    const firstCase = spec.cases[0];
    if (firstCase === undefined) throw new Error("Fixture has no cases");
    firstCase.styleKey = "brian";

    expect(MaterializationSpecSchema.safeParse(spec).success).toBe(false);
  });

  test("rejects non-beta source buckets", () => {
    const spec = validSpec();
    spec.bucket = "scout-prod";

    expect(MaterializationSpecSchema.safeParse(spec).success).toBe(false);
  });
});
