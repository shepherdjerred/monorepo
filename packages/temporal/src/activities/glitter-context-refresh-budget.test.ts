import { describe, expect, test } from "bun:test";
import {
  estimatedCallCostUsd,
  GenerationBudget,
  inputTokenUpperBound,
} from "./glitter-context-refresh-budget.ts";

describe("Glitter generation budget", () => {
  test("uses a byte-based input upper bound and rejects unaffordable misses", () => {
    const callCost = estimatedCallCostUsd({
      model: "gpt-5.6-luna",
      inputTokenUpperBound: inputTokenUpperBound("hello"),
      outputTokenUpperBound: 1000,
    });
    const budget = new GenerationBudget(callCost / 2);

    expect(() => budget.authorizeUncachedCall(callCost)).toThrow(
      "budget exhausted",
    );
  });

  test("counts misses as spend and hits only as reuse", () => {
    const budget = new GenerationBudget(1);
    budget.setPreflightEstimatedCostUsd(0.5);
    budget.record({
      response: { value: "first" },
      key: "artifact-a",
      requestSha256: "a".repeat(64),
      cacheStatus: "miss",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.25,
      },
    });
    budget.record({
      response: { value: "first" },
      key: "artifact-a",
      requestSha256: "a".repeat(64),
      cacheStatus: "hit",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.25,
      },
    });

    expect(budget.summary()).toEqual({
      maxUncachedCostUsd: 1,
      preflightEstimatedCostUsd: 0.5,
      actualUncachedCostUsd: 0.25,
      cacheHits: 1,
      cacheMisses: 1,
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 5,
      artifactKeys: ["artifact-a"],
    });
  });
});
