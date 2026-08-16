import { describe, expect, test } from "bun:test";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";

const ScriptsPackageSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()),
});

describe("release refiner native SDK contract", () => {
  test("loads the native agent SDK entrypoints", () => {
    expect(typeof query).toBe("function");
    expect(typeof Codex).toBe("function");
  });

  test("pins SDKs without retaining the standalone Codex CLI", async () => {
    const manifest = ScriptsPackageSchema.parse(
      await Bun.file(`${import.meta.dir}/package.json`).json(),
    );
    expect(manifest.dependencies["@anthropic-ai/claude-agent-sdk"]).toBe(
      "0.3.220",
    );
    expect(manifest.dependencies["@openai/codex-sdk"]).toBe("0.147.0");
    expect(manifest.dependencies["@openai/codex"]).toBeUndefined();
  });
});
