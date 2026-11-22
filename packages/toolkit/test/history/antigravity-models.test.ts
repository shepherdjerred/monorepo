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

  // Numeric IDs from ccusage #2070: the record's own name (field 19) is
  // gemini-4-carbon for both, at High (1427) and Medium (1437) effort.
  test.each([
    ["model id 1427", normalizeModelName(modelNameFromId(1427))],
    ["model id 1437", normalizeModelName(modelNameFromId(1437))],
    ["internal name", normalizeModelName("gemini-4-carbon-medium")],
    ["display name", normalizeModelName("Gemini 4 Carbon (High)")],
  ])("%s prices as gemini-4-carbon", (_label, model) => {
    expect(model).toBe("gemini-4-carbon");
    const cost = catalogCost([model], USAGE);
    expect(cost.costComplete).toBe(true);
    expect(cost.costUsd).toBeGreaterThan(0);
  });

  test.each([
    [
      "model id 1298",
      normalizeModelName(modelNameFromId(1298)),
      "gemini-3.7-flash",
    ],
    [
      "model id 1401",
      normalizeModelName(modelNameFromId(1401)),
      "claude-opus-5-5",
    ],
    [
      "model id 1404",
      normalizeModelName(modelNameFromId(1404)),
      "claude-sonnet-5-5",
    ],
    [
      "opus effort name",
      normalizeModelName("claude-opus-5-5-medium"),
      "claude-opus-5-5",
    ],
    [
      "sonnet effort name",
      normalizeModelName("claude-sonnet-5-5-high"),
      "claude-sonnet-5-5",
    ],
  ])("%s prices as %s", (_label, model, expected) => {
    expect(model).toBe(expected);
    const cost = catalogCost([model], USAGE);
    expect(cost.costComplete).toBe(true);
    expect(cost.costUsd).toBeGreaterThan(0);
  });
});
