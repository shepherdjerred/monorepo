import { describe, expect, it } from "bun:test";
import { summarize } from "./significance.ts";
import { ExperimentSchema } from "#shared/pr-review/variant.ts";

const experiment = ExperimentSchema.parse({
  id: "test-exp",
  arms: [
    { id: "control", weight: 1 },
    { id: "treatment", weight: 1 },
  ],
  minLabeledPrsPerArm: 30,
  winnerThresholdProbability: 0.95,
});

const windowStarted = new Date("2026-04-01T00:00:00Z");
const windowEnded = new Date("2026-05-01T00:00:00Z");
const win = { windowStarted, windowEnded };

describe("summarize", () => {
  it("returns insufficient-data when any arm is below minLabeledPrsPerArm", () => {
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 5, accepts: 3, dismisses: 2 },
        { variant: "treatment", labeled: 5, accepts: 4, dismisses: 1 },
      ],
      win,
    );
    expect(report.verdict.kind).toBe("insufficient-data");
    if (report.verdict.kind === "insufficient-data") {
      expect(report.verdict.minLabeledRequired).toBe(30);
    }
  });

  it("returns winner-ready when one arm dominates with high probability", () => {
    // Heavily skewed: treatment 50/50, control 5/45 — treatment should
    // beat control with probability ~1.
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 50, accepts: 5, dismisses: 45 },
        { variant: "treatment", labeled: 50, accepts: 45, dismisses: 5 },
      ],
      win,
    );
    expect(report.verdict.kind).toBe("winner-ready");
    if (report.verdict.kind === "winner-ready") {
      expect(report.verdict.winner).toBe("treatment");
      expect(report.verdict.probabilityWinning).toBeGreaterThan(0.95);
    }
  });

  it("returns inconclusive when arms are similar", () => {
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 50, accepts: 25, dismisses: 25 },
        { variant: "treatment", labeled: 50, accepts: 27, dismisses: 23 },
      ],
      win,
    );
    // Slight lean to treatment but not enough to clear the 95% bar.
    expect(report.verdict.kind).toBe("inconclusive");
  });

  it("computes posterior means correctly", () => {
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 50, accepts: 25, dismisses: 25 },
        { variant: "treatment", labeled: 50, accepts: 40, dismisses: 10 },
      ],
      win,
    );
    const control = report.arms.find((a) => a.variant === "control");
    const treatment = report.arms.find((a) => a.variant === "treatment");
    // Beta(1+25, 1+25) mean = 26/52 = 0.5
    expect(control?.posteriorMean).toBeCloseTo(0.5, 2);
    // Beta(1+40, 1+10) mean = 41/52 ≈ 0.788
    expect(treatment?.posteriorMean).toBeCloseTo(41 / 52, 2);
  });

  it("includes arms with zero traffic in the report (so the dashboard shows ramping)", () => {
    const report = summarize(
      experiment,
      [{ variant: "control", labeled: 50, accepts: 30, dismisses: 20 }],
      win,
    );
    expect(report.arms).toHaveLength(2);
    const treatment = report.arms.find((a) => a.variant === "treatment");
    expect(treatment?.labeledCount).toBe(0);
    expect(treatment?.accepts).toBe(0);
    // Prior Beta(1,1) mean = 0.5
    expect(treatment?.posteriorMean).toBeCloseTo(0.5, 2);
  });

  it("pairwiseProbabilities for (v, v) is 0.5 by convention", () => {
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 50, accepts: 30, dismisses: 20 },
        { variant: "treatment", labeled: 50, accepts: 30, dismisses: 20 },
      ],
      win,
    );
    const self = report.pairwiseProbabilities.find(
      (p) => p.row === "control" && p.col === "control",
    );
    expect(self?.p).toBe(0.5);
  });

  it("pairwise P(a > b) + P(b > a) is approximately 1", () => {
    const report = summarize(
      experiment,
      [
        { variant: "control", labeled: 50, accepts: 25, dismisses: 25 },
        { variant: "treatment", labeled: 50, accepts: 30, dismisses: 20 },
      ],
      win,
    );
    const aBeatsB = report.pairwiseProbabilities.find(
      (p) => p.row === "control" && p.col === "treatment",
    );
    const bBeatsA = report.pairwiseProbabilities.find(
      (p) => p.row === "treatment" && p.col === "control",
    );
    expect(aBeatsB).toBeDefined();
    expect(bBeatsA).toBeDefined();
    if (aBeatsB === undefined || bBeatsA === undefined) return;
    // Monte Carlo noise: tolerance of 0.01.
    expect(Math.abs(aBeatsB.p + bBeatsA.p - 1)).toBeLessThan(0.01);
  });
});
