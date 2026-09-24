import { beforeEach, describe, expect, test } from "vitest";
import { getAgentProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";

describe("getAgentProviderOptions", () => {
  beforeEach(() => {
    Bun.env["DISCORD_TOKEN"] ??= "test-token";
    Bun.env["DISCORD_CLIENT_ID"] ??= "123456789012345678";
  });

  test("keeps tool calls serial and forwards the configured effort", () => {
    // The gateway took `parallelToolCalls: false` in an `openrouter` bucket. A
    // first-party provider ignores that bucket, so the guarantee has to arrive
    // in the provider's own key or it is silently lost.
    expect(getAgentProviderOptions("gpt-5.6-sol")).toEqual({
      openai: { parallelToolCalls: false, reasoningEffort: "medium" },
    });
  });

  test("honours a per-turn effort override", () => {
    expect(
      getAgentProviderOptions("gpt-5.6-sol", { reasoningEffort: "low" }),
    ).toMatchObject({ openai: { reasoningEffort: "low" } });
  });

  test("does not forward text verbosity", () => {
    const options = getAgentProviderOptions("gpt-5.6-sol", {
      textVerbosity: "high",
    });
    expect(options?.["openai"]).not.toHaveProperty("textVerbosity");
  });

  test("uses Anthropic's own switch for a Claude model", () => {
    // Sonnet 5 publishes the configured "medium" tier, so effort rides along.
    expect(getAgentProviderOptions("claude-sonnet-5")).toEqual({
      anthropic: { disableParallelToolUse: true, effort: "medium" },
    });
  });

  test("refuses a model that cannot keep tool calls serial", () => {
    expect(() => getAgentProviderOptions("gemini-3.8-flash")).toThrow(
      "cannot disable parallel tool calls",
    );
  });
});
