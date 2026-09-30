import { describe, expect, test } from "vitest";
import {
  reasoningProviderOptions,
  toolLoopProviderOptions,
} from "@shepherdjerred/llm-runtime";

describe("reasoning effort per provider", () => {
  test("OpenAI takes the whole vocabulary", () => {
    expect(reasoningProviderOptions("openai", "gpt-5.6-sol", "none")).toEqual({
      openai: { reasoningEffort: "none" },
    });
  });

  test("Anthropic takes only the tiers an adaptive model publishes", () => {
    expect(
      reasoningProviderOptions("anthropic", "claude-sonnet-5", "high"),
    ).toEqual({ anthropic: { effort: "high" } });
    expect(
      reasoningProviderOptions("anthropic", "claude-sonnet-5", "none"),
    ).toBeUndefined();
    // Haiku has no adaptive thinking, so no effort at all.
    expect(
      reasoningProviderOptions("anthropic", "claude-haiku-4-5", "low"),
    ).toBeUndefined();
  });

  test("Gemini maps onto thinkingLevel and refuses what it lacks", () => {
    expect(
      reasoningProviderOptions("google", "gemini-3.8-flash", "medium"),
    ).toEqual({ google: { thinkingConfig: { thinkingLevel: "medium" } } });
    expect(
      reasoningProviderOptions("google", "gemini-3.8-flash", "xhigh"),
    ).toBeUndefined();
  });
});

describe("tool-loop options", () => {
  test("serial tool calls use each provider's own switch", () => {
    expect(
      toolLoopProviderOptions("gpt-5.6-sol", {
        serialToolCalls: true,
        reasoningEffort: "medium",
      }),
    ).toEqual({
      openai: { parallelToolCalls: false, reasoningEffort: "medium" },
    });
    expect(
      toolLoopProviderOptions("claude-sonnet-5", { serialToolCalls: true }),
    ).toEqual({ anthropic: { disableParallelToolUse: true } });
  });

  test("a Google model is refused when serial tool calls are required", () => {
    // Gemini has no way to turn parallel calls off. Handing the caller a model
    // that might run two side effects at once would break the guarantee it
    // asked for, so this fails instead.
    expect(() =>
      toolLoopProviderOptions("gemini-3.8-flash", { serialToolCalls: true }),
    ).toThrow("cannot disable parallel tool calls");
    expect(
      toolLoopProviderOptions("gemini-3.8-flash", { serialToolCalls: false }),
    ).toBeUndefined();
  });
});
