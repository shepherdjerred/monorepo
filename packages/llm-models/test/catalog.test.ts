import { describe, expect, test } from "bun:test";
import {
  MODELS,
  allModelIds,
  assertModelId,
  costForTextUsage,
  getModel,
  getPerTokenPricing,
  getPricing,
  isModelId,
  modelsByProvider,
} from "#src/index.ts";

describe("catalog integrity", () => {
  test("loads and validates (import would throw otherwise)", () => {
    expect(allModelIds().length).toBeGreaterThan(0);
  });

  test("every key equals its entry.id", () => {
    for (const [key, entry] of Object.entries(MODELS)) {
      expect(entry.id).toBe(key);
    }
  });

  test("all three providers are represented", () => {
    expect(modelsByProvider("openai").length).toBeGreaterThan(0);
    expect(modelsByProvider("anthropic").length).toBeGreaterThan(0);
    expect(modelsByProvider("google").length).toBeGreaterThan(0);
  });

  test("contains the active models we use across all providers", () => {
    const required = [
      // OpenAI
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "text-embedding-3-small",
      // Anthropic
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      // Google
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image-preview",
      "gemini-2.5-flash-image",
    ];
    for (const id of required) {
      expect(isModelId(id)).toBe(true);
    }
  });
});

describe("id guards", () => {
  test("isModelId distinguishes known vs unknown", () => {
    expect(isModelId("gpt-5.5")).toBe(true);
    expect(isModelId("gpt-9000")).toBe(false);
  });

  test("assertModelId throws on unknown", () => {
    expect(() => {
      assertModelId("gpt-9000");
    }).toThrow("Unknown model id");
    expect(() => {
      assertModelId("claude-opus-4-8");
    }).not.toThrow();
  });
});

describe("pricing accessors", () => {
  test("getModel / getPricing return undefined for unknown", () => {
    expect(getModel("nope")).toBeUndefined();
    expect(getPricing("nope")).toBeUndefined();
  });

  test("OpenAI uncached input bills at the full rate (dpp parity)", () => {
    // gpt-5.4-nano input $0.20/1M → 1M tokens = $0.20.
    expect(
      costForTextUsage("gpt-5.4-nano", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.2, 6);
  });

  test("OpenAI cached input bills at the cached rate", () => {
    // 1M input, all cached → $0.02 (cachedInput rate), not $0.20.
    expect(
      costForTextUsage("gpt-5.4-nano", {
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.02, 6);
  });

  test("Anthropic cache read/write bill separately from input (temporal parity)", () => {
    // Haiku: input $1, output $5, cacheRead $0.1, cacheWrite $1.25 per 1M.
    // 10k input + 100k cacheRead + 5k cacheWrite + 2k output.
    const cost = costForTextUsage("claude-haiku-4-5-20251001", {
      inputTokens: 10_000,
      outputTokens: 2000,
      cacheReadTokens: 100_000,
      cacheWriteTokens: 5000,
    });
    const expected =
      (10_000 * 1 + 100_000 * 0.1 + 5000 * 1.25 + 2000 * 5) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 9);
  });

  test("getPerTokenPricing returns fractional rates (monarch parity)", () => {
    expect(getPerTokenPricing("claude-sonnet-4-6")).toEqual({
      input: 3 / 1_000_000,
      output: 15 / 1_000_000,
    });
  });

  test("image models expose perImage and are not text-costable (scout parity)", () => {
    const pricing = getPricing("gemini-3-pro-image-preview");
    expect(pricing?.modality).toBe("image");
    if (pricing?.modality === "image") {
      expect(pricing.perImage).toBeCloseTo(0.134, 6);
    }
    expect(
      costForTextUsage("gemini-3-pro-image-preview", {
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBeUndefined();
  });
});
