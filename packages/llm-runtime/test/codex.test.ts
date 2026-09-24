import { describe, expect, test } from "vitest";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";

describe("Codex SDK configuration", () => {
  test("uses the catalog's native model id and OpenAI's own endpoint", () => {
    // Under the gateway this had to rewrite the model to `openai/gpt-5.6-luna`
    // and override the base URL. Against OpenAI the catalog id IS the API name.
    const config = createCodexConfig({
      apiKey: "sk-test",
      modelId: "gpt-5.6-luna",
    });
    expect(config.model).toBe("gpt-5.6-luna");
    expect(config.apiKey).toBe("sk-test");
    expect(config.env["OPENAI_API_KEY"]).toBe("sk-test");
  });

  test("merges caller env without letting it override the credential", () => {
    const config = createCodexConfig({
      apiKey: "sk-test",
      modelId: "gpt-5.6-sol",
      env: { OPENAI_API_KEY: "sk-stale", CODEX_HOME: "/tmp/codex" },
    });
    expect(config.env["OPENAI_API_KEY"]).toBe("sk-test");
    expect(config.env["CODEX_HOME"]).toBe("/tmp/codex");
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
});
