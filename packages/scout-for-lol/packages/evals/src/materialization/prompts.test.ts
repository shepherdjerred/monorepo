import { describe, expect, test } from "bun:test";

import { loadFrozenPersonality } from "#materialization/prompts.ts";
import {
  MaterializationCaseSpecSchema,
  type MaterializationCaseSpec,
} from "#materialization/spec.ts";

// A real behavior prompt from the Aaron personality metadata
// (packages/data/.../personalities/aaron.json). Freezing must accept it.
const CANONICAL_AARON_BEHAVIOR = "Mention Soju somewhere in your response.";

function caseSpec(selectedBehaviors: string[]): MaterializationCaseSpec {
  return MaterializationCaseSpecSchema.parse({
    matchKey: "games/2026/07/28/NA1_123/match.json",
    patchContext: "",
    performanceSlice: "great",
    playerHistory: "",
    selectedBehaviors,
    styleKey: "aaron",
    targetPlayerId: 12,
    targetPlayerPuuid: "p".repeat(78),
    timelineKey: "games/2026/07/28/NA1_123/timeline.json",
  });
}

describe("loadFrozenPersonality", () => {
  test("freezes canonical behaviors of the selected personality", () => {
    const personality = loadFrozenPersonality(
      caseSpec([CANONICAL_AARON_BEHAVIOR]),
    );

    expect(personality.metadata.randomBehaviors).toEqual([
      { prompt: CANONICAL_AARON_BEHAVIOR, weight: 100 },
    ]);
  });

  test("rejects a behavior that is not from the chosen personality", () => {
    expect(() => loadFrozenPersonality(caseSpec(["tease the player"]))).toThrow(
      "Frozen behavior is not a aaron personality behavior: tease the player",
    );
  });

  test("rejects duplicated frozen behaviors", () => {
    expect(() =>
      loadFrozenPersonality(
        caseSpec([CANONICAL_AARON_BEHAVIOR, CANONICAL_AARON_BEHAVIOR]),
      ),
    ).toThrow(/duplicated/);
  });
});
