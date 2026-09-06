import { describe, expect, test } from "vitest";
import { Codex } from "@openai/codex-sdk";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

const ScriptsPackageSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()),
});

describe("release refiner native SDK contract", () => {
  test("loads the native agent SDK entrypoints", () => {
    expect(typeof Codex).toBe("function");
    expect(typeof createOpenRouterCodexConfig).toBe("function");
  });

  test("pins Codex SDK and the shared OpenRouter adapter", async () => {
    const manifest = ScriptsPackageSchema.parse(
      await Bun.file(`${import.meta.dir}/../package.json`).json(),
    );
    expect(
      manifest.dependencies["@anthropic-ai/claude-agent-sdk"],
    ).toBeUndefined();
    expect(manifest.dependencies["@openai/codex-sdk"]).toBe("0.149.0");
    expect(manifest.dependencies["@shepherdjerred/llm-runtime"]).toBe(
      "workspace:*",
    );
    expect(manifest.dependencies["@openai/codex"]).toBeUndefined();
  });
});
