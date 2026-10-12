import { describe, expect, test, vi } from "vitest";
import {
  checkCodexModelAccess,
  createCodexConfig,
} from "@shepherdjerred/llm-runtime";

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

describe("Codex native model access", () => {
  const input = { apiKey: "fixture-credential", modelId: "gpt-5.6-luna" };

  test("checks the catalog route using the explicit native credential", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: input.modelId }));
    await checkCodexModelAccess(input, request);
    expect(request).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models/gpt-5.6-luna",
      expect.objectContaining({
        headers: { Authorization: "Bearer fixture-credential" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("does not expose credential-bearing provider errors", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(input.apiKey, { status: 401 }));
    await expect(checkCodexModelAccess(input, request)).rejects.toThrow(
      "OpenAI model access failed (HTTP 401)",
    );
    await expect(checkCodexModelAccess(input, request)).rejects.not.toThrow(
      input.apiKey,
    );
  });

  test("rejects a response for a different model", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "other-model" }));
    await expect(checkCodexModelAccess(input, request)).rejects.toThrow(
      "different model",
    );
  });

  test("validates the catalog before contacting the provider", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      checkCodexModelAccess({ ...input, modelId: "claude-sonnet-5" }, request),
    ).rejects.toThrow("routes to anthropic");
    expect(request).not.toHaveBeenCalled();
  });
});
