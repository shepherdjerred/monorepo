import { describe, expect, test } from "bun:test";

import { freshnessAvailability } from "#client/freshness-availability.ts";
import { CaseSummarySchema, type CaseSummary } from "#shared/schema.ts";

function evalCase(input: {
  id: string;
  generationId: string | null;
  isRated: boolean;
  styleKey: string;
}): CaseSummary {
  return CaseSummarySchema.parse({
    id: input.id,
    datasetId: "dataset",
    ordinal: Number(input.id.slice(-1)),
    matchId: `NA1_${input.id}`,
    targetPlayerName: input.id,
    championName: "Poppy",
    performanceSlice: "average",
    styleKey: input.styleKey,
    generationId: input.generationId,
    isRated: input.isRated,
  });
}

describe("freshnessAvailability", () => {
  test("counts only unrated current generated cases and unlocks at zero", () => {
    const ungenerated = evalCase({
      id: "case-0",
      generationId: null,
      isRated: false,
      styleKey: "unused",
    });
    const first = evalCase({
      id: "case-1",
      generationId: "generation-1",
      isRated: false,
      styleKey: "aaron",
    });
    const second = evalCase({
      id: "case-2",
      generationId: "generation-2",
      isRated: false,
      styleKey: "nekoryan",
    });

    expect(freshnessAvailability([ungenerated, first, second])).toEqual({
      generatedCaseCount: 2,
      isAvailable: false,
      missingRatingCount: 2,
      styleKeys: ["aaron", "nekoryan"],
    });
    expect(
      freshnessAvailability([ungenerated, { ...first, isRated: true }, second]),
    ).toMatchObject({
      generatedCaseCount: 2,
      isAvailable: false,
      missingRatingCount: 1,
    });
    expect(
      freshnessAvailability([
        ungenerated,
        { ...first, isRated: true },
        { ...second, isRated: true },
      ]),
    ).toEqual({
      generatedCaseCount: 2,
      isAvailable: true,
      missingRatingCount: 0,
      styleKeys: ["aaron", "nekoryan"],
    });
  });
});
