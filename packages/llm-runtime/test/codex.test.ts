import { describe, expect, test } from "vitest";
import {
  createOpenRouterCodexConfig,
  OPENROUTER_API_BASE_URL,
} from "@shepherdjerred/llm-runtime";

describe("OpenRouter Codex SDK configuration", () => {
  test.each([
    ["gpt-5.6-luna", "openai/gpt-5.6-luna"],
    ["gpt-5.6-sol", "openai/gpt-5.6-sol"],
  ])("routes %s through OpenRouter", (modelId, routeModelId) => {
    const config = createOpenRouterCodexConfig({
      apiKey: "test-key",
      modelId,
      env: { PATH: "/usr/bin" },
    });
    expect(config).toEqual({
      catalogModelId: modelId,
      routeModelId,
      codexOptions: {
        apiKey: "test-key",
        baseUrl: OPENROUTER_API_BASE_URL,
        env: { PATH: "/usr/bin" },
      },
    });
  });

  test("rejects missing keys and non-language routes", () => {
    expect(() =>
      createOpenRouterCodexConfig({ apiKey: " ", modelId: "gpt-5.6-luna" }),
    ).toThrow("OpenRouter API key must not be empty");
    expect(() =>
      createOpenRouterCodexConfig({
        apiKey: "test-key",
        modelId: "text-embedding-3-small",
      }),
    ).toThrow("uses OpenRouter embedding, not language");
  });
});
