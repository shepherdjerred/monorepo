import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("#src/configuration.ts", () => ({
  default: { inferenceConfigured: true },
}));

let resetAiClientsForTests: (() => void) | undefined;

afterEach(() => {
  resetAiClientsForTests?.();
  vi.unstubAllEnvs();
});

describe("review provider clients", () => {
  test("only exposes image generation when Gemini credentials are configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    const clients = await import("../ai-clients.ts");
    resetAiClientsForTests = clients.resetAiClientsForTests;

    expect(clients.getTextGenerationClient()).toBeDefined();
    expect(clients.getImageGenerationClient()).toBeUndefined();

    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    clients.resetAiClientsForTests();
    expect(clients.getImageGenerationClient()).toBeDefined();
  });
});
