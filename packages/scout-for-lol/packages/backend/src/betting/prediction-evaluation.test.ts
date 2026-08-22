import { describe, expect, test } from "vitest";
import {
  calculatePredictionMetrics,
  evaluatePredictions,
} from "#src/betting/prediction-evaluation.ts";

describe("prediction evaluation metrics", () => {
  const observations = [
    { queue: "solo", dataQuality: "high", probability: 0.8, blueWon: true },
    { queue: "flex", dataQuality: "low", probability: 0.2, blueWon: false },
  ];

  test("calculates Brier, log loss, ten-bin calibration, and direction", () => {
    const metrics = calculatePredictionMetrics(observations);
    expect(metrics.sampleSize).toBe(2);
    expect(metrics.brierScore).toBeCloseTo(0.04, 12);
    expect(metrics.logLoss).toBeCloseTo(-Math.log(0.8), 12);
    expect(metrics.calibrationError).toBeCloseTo(0.2, 12);
    expect(metrics.directionalAccuracy).toBe(1);
  });

  test("reports queue/quality slices and a computed 50/50 reference", () => {
    const report = evaluatePredictions(observations);
    expect(report.byQueue["solo"]?.sampleSize).toBe(1);
    expect(report.byQueue["flex"]?.sampleSize).toBe(1);
    expect(report.byQuality["high"]?.sampleSize).toBe(1);
    expect(report.byQuality["low"]?.sampleSize).toBe(1);
    expect(report.reference50.brierScore).toBe(0.25);
    expect(report.reference50.logLoss).toBeCloseTo(Math.log(2), 12);
    expect(report.reference50.directionalAccuracy).toBe(0.5);
  });

  test("scores a 50/50 directional reference neutrally on imbalanced data", () => {
    const report = evaluatePredictions([
      ...observations,
      {
        queue: "solo",
        dataQuality: "high",
        probability: 0.9,
        blueWon: true,
      },
    ]);
    expect(report.reference50.directionalAccuracy).toBe(0.5);
  });
});
