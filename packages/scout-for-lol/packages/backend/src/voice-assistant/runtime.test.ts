import { afterEach, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { resolveVoiceCredential } from "#src/voice-assistant/runtime.ts";

const credentialFile = `/tmp/scout-voice-credential-${crypto.randomUUID()}`;

afterEach(async () => {
  await rm(credentialFile, { force: true });
});

describe("resolveVoiceCredential", () => {
  test("observes a Secret file that appears after the process starts", async () => {
    const config = {
      openAiApiKeyFile: credentialFile,
      assetsDir: "/tmp/voice",
      kwsRuntime: "wasm" as const,
    };

    expect(await resolveVoiceCredential(config)).toBeUndefined();
    await Bun.write(credentialFile, "sk-projected\n");
    expect(await resolveVoiceCredential(config)).toBe("sk-projected");
  });

  test("prefers the direct development credential", async () => {
    await Bun.write(credentialFile, "sk-projected");
    expect(
      await resolveVoiceCredential({
        openAiApiKey: "sk-direct",
        openAiApiKeyFile: credentialFile,
        assetsDir: "/tmp/voice",
        kwsRuntime: "native",
      }),
    ).toBe("sk-direct");
  });
});
