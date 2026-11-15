import { describe, expect, test } from "vitest";
import {
  modelNameFromId,
  normalizeModelName,
} from "#lib/history/sources/antigravity/antigravity-models.ts";
import { catalogCost } from "#lib/history/usage-cost.ts";

const USAGE = {
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

describe("antigravity model ids resolve to catalog models", () => {
  test.each([
    ["model id 1318", normalizeModelName(modelNameFromId(1318))],
    ["model id 1319", normalizeModelName(modelNameFromId(1319))],
    ["model id 1320", normalizeModelName(modelNameFromId(1320))],
    ["internal name", normalizeModelName("gemini-3.8-flash-n")],
    ["display name", normalizeModelName("Gemini 3.8 Flash (High)")],
  ])("%s prices as gemini-3.8-flash", (_label, model) => {
    expect(model).toBe("gemini-3.8-flash");
    const cost = catalogCost([model], USAGE);
    expect(cost.costComplete).toBe(true);
    expect(cost.costUsd).toBeGreaterThan(0);
  });
});
