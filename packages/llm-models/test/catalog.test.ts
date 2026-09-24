import { describe, expect, test } from "vitest";
import {
  MODELS,
  allModelIds,
  assertModelId,
  costForTextUsage,
  costForTextUsageByTurn,
  getModel,
  getNativeRoute,
  getPerTokenPricing,
  getPricing,
  isModelId,
  modelIdForNativeRoute,
  modelsByProvider,
  requireNativeRoute,
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
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
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

  test("current and preview models have explicit native routes", () => {
    for (const model of Object.values(MODELS)) {
      expect(model.capabilities.inputModalities.length).toBeGreaterThan(0);
      expect(model.capabilities.outputModalities.length).toBeGreaterThan(0);
      if (model.status !== "deprecated") {
        expect(model.routes.native).toBeDefined();
      }
    }
  });

  test("native coding-agent routes are explicit", () => {
    expect(MODELS["claude-opus-5"]?.routes.claudeAgentSdk?.modelId).toBe(
      "claude-opus-5",
    );
    expect(MODELS["gpt-5.6-sol"]?.routes.codexSdk?.modelId).toBe("gpt-5.6-sol");
  });

  test("resolves native routes back to stable ids", () => {
    expect(modelIdForNativeRoute("openai", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(modelIdForNativeRoute("openai", "missing-model")).toBeUndefined();
    // The gateway reached both of these through one aliased route, so neither
    // could be attributed. Anthropic addresses them separately, so a dated run
    // and an alias run are now told apart.
    expect(modelIdForNativeRoute("anthropic", "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5",
    );
    expect(
      modelIdForNativeRoute("anthropic", "claude-haiku-4-5-20251001"),
    ).toBe("claude-haiku-4-5-20251001");
    // The model id alone is not the key: another provider serving the same
    // upstream name is a different route.
    expect(modelIdForNativeRoute("google", "gpt-5.6-sol")).toBeUndefined();
  });
});

describe("id guards", () => {
  test("isModelId distinguishes known vs unknown", () => {
    expect(isModelId("gpt-5.5")).toBe(true);
    expect(isModelId("gpt-9000")).toBe(false);
  });

  test("resolves exact native routes without model fallback", () => {
    expect(getNativeRoute("gpt-5.6-sol")).toEqual({
      provider: "openai",
      modelId: "gpt-5.6-sol",
      endpoint: "language",
    });
    expect(requireNativeRoute("text-embedding-3-small", "embedding")).toEqual({
      provider: "openai",
      modelId: "text-embedding-3-small",
      endpoint: "embedding",
    });
    expect(() =>
      requireNativeRoute("text-embedding-3-small", "language"),
    ).toThrow("uses openai embedding, not language");
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

  test("Luna pricing includes cache writes and the published long-context tier", () => {
    expect(getPricing("gpt-5.6-luna")).toEqual({
      modality: "text",
      input: 0.2,
      cachedInput: 0.02,
      cacheWrite: 0.25,
      output: 1.2,
      longContextSurcharge: {
        thresholdInputTokens: 272_000,
        inputMultiplier: 2,
        outputMultiplier: 1.5,
      },
    });
    expect(
      costForTextUsage("gpt-5.6-luna", {
        inputTokens: 272_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo((272_000 * 0.2 + 100_000 * 1.2) / 1_000_000, 9);
    expect(
      costForTextUsage("gpt-5.6-luna", {
        inputTokens: 272_001,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo((272_001 * 0.2 * 2 + 100_000 * 1.2 * 1.5) / 1_000_000, 9);
    expect(
      costForTextUsage("gpt-5.6-luna", {
        inputTokens: 270_000,
        cacheWriteTokens: 2001,
        outputTokens: 0,
      }),
    ).toBeCloseTo(((270_000 * 0.2 + 2001 * 0.25) * 2) / 1_000_000, 9);
  });

  test("Luna cache reads stay on cached-input pricing with cache writes", () => {
    expect(
      costForTextUsage("gpt-5.6-luna", {
        inputTokens: 200_000,
        cachedInputTokens: 100_000,
        cacheWriteTokens: 1000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(
      (100_000 * 0.2 + 100_000 * 0.02 + 1000 * 0.25) / 1_000_000,
      9,
    );
  });

  test("long-context surcharge applies independently to each turn", () => {
    const turns = [
      { inputTokens: 200_000, outputTokens: 100_000 },
      { inputTokens: 200_000, outputTokens: 100_000 },
    ];
    expect(costForTextUsageByTurn("gpt-5.6-luna", turns)).toBeCloseTo(
      (400_000 * 0.2 + 200_000 * 1.2) / 1_000_000,
      9,
    );
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

describe("native pricing dimensions", () => {
  test("OpenAI cache reads bill at cachedInput, not the full input rate", () => {
    // The AI SDK reports cache reads in the same non-overlapping cacheRead slot
    // for every provider, but OpenAI publishes that rate as `cachedInput` and
    // carries no `cacheRead`. Falling back to `input` would bill nano's cache
    // reads at $0.20/1M instead of $0.02/1M.
    expect(
      costForTextUsage("gpt-5.4-nano", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.02, 9);
    // Anthropic publishes cacheRead explicitly and it still wins.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.1, 9);
  });

  test("1h cache writes bill at 2x input, not the 5m rate", () => {
    // Haiku: input $1/1M, so 5m writes $1.25 and 1h writes $2. Pricing only the
    // flat (5m) rate would understate a 1h write by 37.5%.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokensByTtl: { "1h": 1_000_000 },
      }),
    ).toBeCloseTo(2, 9);
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokensByTtl: { "5m": 1_000_000 },
      }),
    ).toBeCloseTo(1.25, 9);
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokensByTtl: { "5m": 400_000, "1h": 600_000 },
      }),
    ).toBeCloseTo(0.4 * 1.25 + 0.6 * 2, 9);
  });

  test("the TTL split wins over the undifferentiated total, never adds to it", () => {
    // Anthropic reports both cache_creation_input_tokens and the per-TTL
    // breakdown for the SAME tokens. Summing both would bill every write twice.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWriteTokensByTtl: { "5m": 1_000_000 },
      }),
    ).toBeCloseTo(1.25, 9);
  });

  test("batch tier halves the whole turn", () => {
    const standard = costForTextUsage("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const batch = costForTextUsage("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      serviceTier: "batch",
    });
    expect(standard).toBeCloseTo(6, 9);
    expect(batch).toBeCloseTo(3, 9);
  });

  test("a tier with no multiplier on file prices nothing rather than guessing", () => {
    // Anthropic publishes no priority rate for Haiku, so the honest answer is
    // "no list price", not a silent 1.0 multiplier.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 1000,
        outputTokens: 0,
        serviceTier: "priority",
      }),
    ).toBeUndefined();
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 1000,
        outputTokens: 0,
        serviceTier: "standard",
      }),
    ).toBeCloseTo(0.001, 9);
  });

  test("web search bills per request on top of tokens", () => {
    // $10 per 1,000 searches, and it is counted, not measured -- three searches
    // cost $0.03 regardless of token volume.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        serverToolRequests: { webSearch: 3 },
      }),
    ).toBeCloseTo(1 + 0.03, 9);
    // The batch multiplier stacks onto the tool charge too.
    expect(
      costForTextUsage("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        serviceTier: "batch",
        serverToolRequests: { webSearch: 2 },
      }),
    ).toBeCloseTo(0.01, 9);
  });

  test("a billed server tool with no price on file prices nothing", () => {
    // OpenAI models carry no webSearchPerRequest, so a search there is a gap we
    // surface rather than a cost we invent.
    expect(
      costForTextUsage("gpt-5.4-nano", {
        inputTokens: 1000,
        outputTokens: 0,
        serverToolRequests: { webSearch: 1 },
      }),
    ).toBeUndefined();
  });
});
