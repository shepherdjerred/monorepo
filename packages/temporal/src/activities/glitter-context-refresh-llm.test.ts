import { describe, expect, test } from "bun:test";
import { GenerationBudget } from "./glitter-context-refresh-budget.ts";
import {
  readGlitterObjectArtifact,
  useGlitterObjectArtifact,
} from "./glitter-context-refresh-llm.ts";
import type { GenerationArtifactResult } from "./glitter-context-refresh-cache.ts";

const requestSha256 = "a".repeat(64);

function artifact(
  response:
    | { outcome: "success"; value: { ok: true } }
    | { outcome: "failure"; error: string; rawContent: string | null },
): GenerationArtifactResult<typeof response> {
  return {
    response,
    key: "artifact",
    requestSha256,
    cacheStatus: "hit",
    billedToCurrentRun: false,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      costUsd: 0,
    },
  };
}

describe("glitter object artifacts", () => {
  test("readGlitterObjectArtifact records a cached parse failure without throwing", () => {
    const budget = new GenerationBudget(1);
    const response = readGlitterObjectArtifact({
      artifact: artifact({
        outcome: "failure",
        error: "GPT-5.6 Luna did not return a parsed summary for 2023-03-0000",
        rawContent: null,
      }),
      budget,
    });
    expect(response).toEqual({
      outcome: "failure",
      error: "GPT-5.6 Luna did not return a parsed summary for 2023-03-0000",
      rawContent: null,
    });
    expect(budget.summary().cacheHits).toBe(1);
  });

  test("useGlitterObjectArtifact still fails the call site that cannot repair", () => {
    const budget = new GenerationBudget(1);
    expect(() =>
      useGlitterObjectArtifact({
        artifact: artifact({
          outcome: "failure",
          error: "GPT-5.6 Sol did not return a parsed synthesis for aaron",
          rawContent: null,
        }),
        budget,
      }),
    ).toThrow("GPT-5.6 Sol did not return a parsed synthesis for aaron");
  });
});
