import { describe, expect, test } from "bun:test";
import { ApplicationFailure } from "@temporalio/common";
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

    let failure: unknown;
    try {
      budget.authorizeUncachedCall(callCost);
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(failure.type).toBe("GlitterGenerationBudgetExhausted");
    expect(failure.nonRetryable).toBe(true);
  });

  test("restores same-run hit spend without charging prior-run hits", () => {
    const budget = new GenerationBudget(1);
    budget.setPreflightEstimatedCostUsd(0.5);
    budget.record({
      response: { value: "first" },
      key: "artifact-a",
      requestSha256: "a".repeat(64),
      cacheStatus: "miss",
      billedToCurrentRun: true,
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
      billedToCurrentRun: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.25,
      },
    });
    budget.record({
      response: { value: "second" },
      key: "artifact-b",
      requestSha256: "b".repeat(64),
      cacheStatus: "hit",
      billedToCurrentRun: true,
      usage: {
        inputTokens: 60,
        outputTokens: 10,
        cachedInputTokens: 3,
        costUsd: 0.15,
      },
    });
    budget.record({
      response: { value: "prior dry run" },
      key: "artifact-c",
      requestSha256: "c".repeat(64),
      cacheStatus: "hit",
      billedToCurrentRun: false,
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        cachedInputTokens: 50,
        costUsd: 0.5,
      },
    });

    expect(budget.summary()).toEqual({
      maxUncachedCostUsd: 1,
      preflightEstimatedCostUsd: 0.5,
      actualUncachedCostUsd: 0.4,
      cacheHits: 3,
      cacheMisses: 1,
      inputTokens: 160,
      outputTokens: 30,
      cachedInputTokens: 8,
      artifactKeys: ["artifact-a", "artifact-b", "artifact-c"],
    });
  });
});
