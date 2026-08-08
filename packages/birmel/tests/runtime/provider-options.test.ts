import { beforeEach, describe, expect, test } from "bun:test";
import { getOpenAIProviderOptions } from "@shepherdjerred/birmel/agent-runtime/provider-options.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";

describe("getOpenAIProviderOptions", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENAI_API_KEY"] = "test-openai-key";
    resetConfig();
  });

  test("keeps tool-loop reasoning self-contained without provider storage", () => {
    const options = getOpenAIProviderOptions();
    const serialized = JSON.stringify(options);

    expect(options.openai.store).toBe(false);
    expect(options.openai.parallelToolCalls).toBe(false);
    expect(options.openai.include).toEqual(["reasoning.encrypted_content"]);
    expect("previousResponseId" in options.openai).toBe(false);
    expect(serialized).toContain("reasoning.encrypted_content");
    expect(serialized).not.toContain("reasoningEncryptedContent");
  });
});
