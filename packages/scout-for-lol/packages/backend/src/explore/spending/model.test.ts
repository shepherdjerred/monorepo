import { getPricing } from "@shepherdjerred/llm-models";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  settle: vi.fn(),
}));

// Pricing is the real ledger's; only the reservation and settlement, which
// write to the database, are stand-ins.
vi.mock("#src/explore/spending/ledger.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  reserveExploreCall: mocks.reserve,
  settleExploreCall: mocks.settle,
}));

const { pricingForExplore } = await import("#src/explore/spending/ledger.ts");
const { exploreOpenAiProviderOptions, withExploreSpend } =
  await import("#src/explore/spending/model.ts");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({
    id: "spend-1",
    maxOutputTokens: 900,
    amount: 10,
    rates: { input: 1, cachedInput: 1, cacheWrite: 1, output: 1 },
  });
});

test("Explore requests the fastest OpenAI tier each model offers", () => {
  const shared = {
    openai: { strictJsonSchema: true, promptCacheKey: "scout.explore" },
  };
  expect(exploreOpenAiProviderOptions("gpt-6-luna", shared)).toEqual({
    openai: {
      strictJsonSchema: true,
      promptCacheKey: "scout.explore",
      reasoningEffort: "high",
      serviceTier: "fast",
    },
  });
  expect(exploreOpenAiProviderOptions("gpt-6.1-sol", shared)).toEqual({
    openai: {
      strictJsonSchema: true,
      promptCacheKey: "scout.explore",
      reasoningEffort: "high",
      serviceTier: "ultrafast",
    },
  });

  for (const [model, multiplier] of [
    ["gpt-6-luna", 2],
    ["gpt-6.1-sol", 6],
  ] as const) {
    const standard = getPricing(model);
    if (standard?.modality !== "text") {
      throw new Error(`${model} has no text price`);
    }
    expect(pricingForExplore(model)).toEqual({
      input: standard.input * multiplier,
      cachedInput: (standard.cachedInput ?? standard.input) * multiplier,
      cacheWrite: (standard.cacheWrite ?? standard.input) * multiplier,
      output: standard.output * multiplier,
    });
  }
});

describe("withExploreSpend", () => {
  test.each(["high", "low"] as const)(
    "sends the %s reasoning effort it was given, inside the reserved output",
    async (reasoningEffort) => {
      const provider = new MockLanguageModelV4({
        // The call options are what is under test; the answer is not.
        doGenerate: async () => {
          throw new Error("provider reached");
        },
      });
      const model = withExploreSpend(provider, {
        ownerId: "160509172704739328",
        runId: "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43",
        model: "gpt-6-luna",
        reasoningEffort,
      });

      await expect(
        model.doGenerate({
          prompt: [],
          maxOutputTokens: 1200,
          providerOptions: { openai: { store: false } },
        }),
      ).rejects.toThrow("provider reached");

      expect(mocks.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 1200, model: "gpt-6-luna" }),
      );
      expect(provider.doGenerateCalls).toEqual([
        expect.objectContaining({
          maxOutputTokens: 900,
          providerOptions: {
            openai: { store: false, reasoningEffort, serviceTier: "fast" },
          },
        }),
      ]);
    },
  );
});
