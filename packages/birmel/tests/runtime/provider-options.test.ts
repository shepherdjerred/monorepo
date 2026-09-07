import { beforeEach, describe, expect, test } from "vitest";
import { getOpenRouterProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";

describe("getOpenRouterProviderOptions", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENROUTER_API_KEY"] = "test-openrouter-key";
    resetConfig();
  });

  test("keeps tool execution serial and configures gateway reasoning", () => {
    const options = getOpenRouterProviderOptions();

    expect(options.openrouter.parallelToolCalls).toBe(false);
    expect(options.openrouter.reasoning).toEqual({
      effort: "medium",
      exclude: false,
    });
  });

  test("does not forward text verbosity because gpt-5.6-sol endpoints reject it", () => {
    const options = getOpenRouterProviderOptions({
      reasoningEffort: "low",
      textVerbosity: "low",
    });

    expect(options.openrouter.reasoning.effort).toBe("low");
    expect(options.openrouter).not.toHaveProperty("verbosity");
  });
});
