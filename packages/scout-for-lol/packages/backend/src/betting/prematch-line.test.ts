import { describe, expect, test } from "bun:test";
import { BucksPredictionSchema } from "@scout-for-lol/data/index.ts";
import {
  appendBucksLine,
  bucksPrematchLine,
} from "#src/betting/prematch-line.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";

function prediction(winProbability: number) {
  return BucksPredictionSchema.parse({
    winProbability,
    subjectTeamId: 100,
    confidence: "medium",
    sentence: "Scout's call: Aaron WINS — 60%.",
    drivers: [],
  });
}

describe("bucksPrematchLine", () => {
  test("keeps an interesting call and states the complete house policy", () => {
    const line = bucksPrematchLine({ prediction: prediction(0.6) });

    expect(line).toBe(`Scout's call: Aaron WINS — 60%.\n${HOUSE_CUT_TERMS}`);
    expect(line).not.toContain("Bets close");
    expect(line).not.toContain("/bb balance");
    expect(line).not.toContain("BB:CAD");
  });

  test("omits a near-even call while leaving the market available", () => {
    expect(bucksPrematchLine({ prediction: prediction(0.49) })).toBe(
      HOUSE_CUT_TERMS,
    );
  });

  test("does not add blank content when there is no call", () => {
    expect(appendBucksLine("Aaron and Long started a game", "")).toBe(
      "Aaron and Long started a game",
    );
  });

  test("keeps the house policy when the base reaches Discord's limit", () => {
    const message = appendBucksLine("x".repeat(2000), HOUSE_CUT_TERMS);

    expect(message).toHaveLength(2000);
    expect(message.endsWith(HOUSE_CUT_TERMS)).toBe(true);
  });
});
