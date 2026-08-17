import { describe, expect, test } from "bun:test";
import {
  BucksPredictionSchema,
  type BucksPrediction,
} from "@scout-for-lol/data/index.ts";
import { predictionVerdict } from "#src/betting/announce.ts";

function prediction(
  winProbability: number,
  subjectTeamId = 100,
): BucksPrediction {
  return BucksPredictionSchema.parse({
    winProbability,
    subjectTeamId,
    confidence: "low",
    sentence: "Coin flip.",
    drivers: [],
  });
}

describe("predictionVerdict", () => {
  test("scores a confident call that landed", () => {
    expect(predictionVerdict(prediction(0.72, 100), 100)).toBe(
      "Scout called it.",
    );
    expect(predictionVerdict(prediction(0.28, 100), 200)).toBe(
      "Scout called it.",
    );
  });

  test("scores a confident call that missed", () => {
    expect(predictionVerdict(prediction(0.72, 100), 200)).toBe(
      "Scout was wrong.",
    );
    expect(predictionVerdict(prediction(0.28, 100), 100)).toBe(
      "Scout was wrong.",
    );
  });

  // The formula has no intercept, so a symmetric lobby returns exactly 0.500 —
  // a supported result, and a declined call rather than a call that the subject
  // loses. Scoring it either way makes the recap claim a direction the stored
  // sentence never took.
  test("declines to score an exact coin flip, whichever side won", () => {
    expect(predictionVerdict(prediction(0.5, 100), 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.5, 100), 200)).toBeUndefined();
  });

  test("declines to score a near-even call", () => {
    expect(predictionVerdict(prediction(0.51, 100), 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.49, 100), 100)).toBeUndefined();
  });

  test("has no verdict without a prediction or a decided result", () => {
    expect(predictionVerdict(undefined, 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.72, 100), undefined)).toBeUndefined();
  });
});
