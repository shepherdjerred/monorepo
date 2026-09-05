import { describe, expect, test } from "vitest";
import { DareV2InspectionSchema } from "#src/betting/dares/presentation/dare-view-model-v2.ts";
import { TWISTED_FATE_SAME_GAME_PLAN } from "#src/betting/dares/dare-v2-test-fixtures.ts";

/**
 * A plan holding a value that predates the domain rules — the shape both dares
 * still active on beta are in (`team_position = 'SUPPORT'`).
 */
const LEGACY_PLAN = {
  ...TWISTED_FATE_SAME_GAME_PLAN,
  gameSets: [
    {
      ...TWISTED_FATE_SAME_GAME_PLAN.gameSets[0],
      predicate: {
        kind: "comparison",
        value: {
          kind: "participant",
          target: "virmel",
          field: "team_position",
        },
        operator: "eq",
        threshold: "SUPPORT",
      },
    },
  ],
};

describe("Dare v2 inspection response", () => {
  // Tightening the authoring schema must not make an already-funded dare
  // unreadable through the detail API. The response schema re-validates the
  // plan, so it needs the stored variant as much as the parse sites do.
  test("carries a plan whose value predates the domain rules", () => {
    const parsed = DareV2InspectionSchema.shape.plan.safeParse(LEGACY_PLAN);
    expect(parsed.success).toBe(true);
  });

  test("still rejects a structurally invalid plan", () => {
    expect(
      DareV2InspectionSchema.shape.plan.safeParse({
        ...LEGACY_PLAN,
        gameSets: [],
      }).success,
    ).toBe(false);
  });
});
