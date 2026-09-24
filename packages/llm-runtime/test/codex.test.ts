import { describe, expect, test } from "vitest";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";

describe("Codex SDK configuration", () => {
  test("uses the catalog's native model id and OpenAI's own endpoint", () => {
    // Under the gateway this rewrote the model to `openai/gpt-5.6-luna` and
    // overrode the base URL. Against OpenAI the catalog id IS the API name, and
    // no base URL is set at all.
    const config = createCodexConfig({
      apiKey: "sk-test",
      modelId: "gpt-5.6-luna",
    });
    expect(config.catalogModelId).toBe("gpt-5.6-luna");
    expect(config.routeModelId).toBe("gpt-5.6-luna");
    expect(config.codexOptions.apiKey).toBe("sk-test");
    expect(config.codexOptions).not.toHaveProperty("baseUrl");
  });

  test("passes caller env through untouched", () => {
    const config = createCodexConfig({
      apiKey: "sk-test",
      modelId: "gpt-5.6-sol",
      env: { CODEX_HOME: "/tmp/codex" },
    });
    expect(config.codexOptions.env).toEqual({ CODEX_HOME: "/tmp/codex" });
  });

  test("refuses a model Codex cannot serve", () => {
    expect(() =>
      createCodexConfig({ apiKey: "sk-test", modelId: "claude-sonnet-5" }),
    ).toThrow("routes to anthropic");
    expect(() =>
      createCodexConfig({ apiKey: "sk-test", modelId: "gpt-9000" }),
    ).toThrow("Unknown model id");
    expect(() =>
      createCodexConfig({
        apiKey: "sk-test",
        modelId: "text-embedding-3-small",
      }),
    ).toThrow("not language");
  });

  test("refuses an empty key", () => {
    expect(() =>
      createCodexConfig({ apiKey: "   ", modelId: "gpt-5.6-luna" }),
    ).toThrow("must not be empty");
  });
});
