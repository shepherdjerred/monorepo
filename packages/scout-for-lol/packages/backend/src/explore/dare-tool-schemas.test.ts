import { describe, expect, test } from "vitest";
import { prepareDareDraftV2 } from "#src/betting/dares/lifecycle/dare-draft-v2.ts";
import { DareDefinitionV2ToolInputSchema } from "#src/explore/dare-tool-schemas.ts";

/** A contract whose lane spelling Riot never emits. */
const INVALID_LANE_DEFINITION = {
  originalText: "Play mid lane",
  targetKeys: ["T1"],
  plan: {
    version: 2,
    maxEligibleGames: 1,
    gameSets: [
      {
        name: "games",
        targetKeys: ["T1"],
        relationship: "independent",
        queues: ["solo"],
        predicate: {
          kind: "comparison",
          value: { kind: "participant", target: "T1", field: "team_position" },
          operator: "eq",
          threshold: "MID",
        },
        projections: [],
        orderBy: "game_end_at_asc_match_id_asc",
        limit: 1,
      },
    ],
    result: {
      kind: "matching_games",
      gameSet: "games",
      operator: "gte",
      threshold: 1,
    },
  },
  deadlineSpec: { kind: "relative", days: 7 },
  openingStake: 5,
};

describe("Dare v2 tool input schema", () => {
  // The AI SDK validates tool input against this schema before the executor
  // runs. If the value-domain refinement lived here, the SDK would reject the
  // call itself and the model would see a generic invalid-tool-input error
  // instead of the issue text naming MIDDLE — so the domain check has to be
  // reachable, not pre-empted.
  test("accepts an out-of-domain plan so the executor can answer it", () => {
    expect(
      DareDefinitionV2ToolInputSchema.safeParse(INVALID_LANE_DEFINITION)
        .success,
    ).toBe(true);
  });

  test("still rejects a structurally invalid plan at the tool boundary", () => {
    expect(
      DareDefinitionV2ToolInputSchema.safeParse({
        ...INVALID_LANE_DEFINITION,
        plan: { ...INVALID_LANE_DEFINITION.plan, gameSets: [] },
      }).success,
    ).toBe(false);
  });

  test("the executor returns the actionable domain issue", () => {
    const parsed = DareDefinitionV2ToolInputSchema.parse(
      INVALID_LANE_DEFINITION,
    );
    const prepared = prepareDareDraftV2({
      originalText: parsed.originalText,
      plan: parsed.plan,
      targets: [
        {
          key: "T1",
          discordId: "100000000000000001",
          playerId: 1,
          alias: "Virmel",
          accounts: [
            {
              puuid: "frozen-puuid",
              trackingStartedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      deadlineSpec: parsed.deadlineSpec,
      openingStake: parsed.openingStake,
    });
    expect(prepared.kind).toBe("invalid");
    expect(
      prepared.kind === "invalid" ? prepared.issues.join(" ") : "",
    ).toContain("MIDDLE");
  });
});
