import { describe, expect, test } from "vitest";
import {
  type DecisionCase,
  latencyOf,
  verdictFromScores,
} from "#src/tips/eval/decisions.ts";

const scores = (pCorrect: number, pWrong: number, pNotCheckable: number) => ({
  pCorrect,
  pWrong,
  pNotCheckable,
  pUseful: 0.7,
});

describe("the Decisions judge verdicts", () => {
  test("take the likeliest answer when no threshold is set", () => {
    expect(verdictFromScores(scores(0.7, 0.2, 0.1)).correctness).toBe(
      "correct",
    );
    expect(verdictFromScores(scores(0.2, 0.7, 0.1)).correctness).toBe("wrong");
    expect(verdictFromScores(scores(0.1, 0.2, 0.7)).correctness).toBe(
      "not-checkable",
    );
  });

  test("call a tip wrong at a probability threshold even when another answer is likelier", () => {
    const tip = scores(0.6, 0.3, 0.1);
    expect(verdictFromScores(tip, 0.5).correctness).toBe("correct");
    expect(verdictFromScores(tip, 0.3).correctness).toBe("wrong");
  });

  test("read the useful answer as a probability of at least one half", () => {
    expect(verdictFromScores(scores(1, 0, 0)).useful).toBe(true);
    expect(verdictFromScores({ ...scores(1, 0, 0), pUseful: 0.2 }).useful).toBe(
      false,
    );
  });
});

describe("latencyOf", () => {
  test("reports the mean, the 95th percentile and the maximum", () => {
    const cases: DecisionCase[] = Array.from({ length: 20 }, (_, index) => ({
      report: "r",
      case: index,
      sets: [],
      costUsd: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      milliseconds: (index + 1) * 100,
    }));
    expect(latencyOf(cases)).toEqual({
      meanMs: 1050,
      p95Ms: 2000,
      maxMs: 2000,
    });
  });
});
