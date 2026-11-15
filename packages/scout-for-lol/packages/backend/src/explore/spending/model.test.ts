import { getPricing } from "@shepherdjerred/llm-models";
import { expect, test } from "vitest";
import { pricingForExplore } from "#src/explore/spending/ledger.ts";
import { exploreOpenAiProviderOptions } from "#src/explore/spending/model.ts";

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
