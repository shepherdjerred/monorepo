import { describe, expect, test } from "vitest";
import { loadBrainConfig } from "#src/config.ts";

const base = {
  STORM_BRAIN_BEARER_TOKEN: "a-bearer-token-that-is-long-enough!!",
};

describe("storm-brain config", () => {
  test("loads defaults", () => {
    const config = loadBrainConfig({ environment: { ...base } });
    return expect(config).resolves.toMatchObject({
      model: "gpt-6-luna",
      decisionsModel: "gpt-6-luna",
      conversationModel: "gpt-6-luna",
      maxBodyBytes: 262_144,
      llmTimeoutMs: 60_000,
      port: 3000,
      metricsPort: 9090,
    });
  });

  test("requires STORM_BRAIN_BEARER_TOKEN", () => {
    return expect(loadBrainConfig({ environment: {} })).rejects.toThrow(
      /STORM_BRAIN_BEARER_TOKEN/,
    );
  });

  test("rejects short bearer tokens", async () => {
    await expect(
      loadBrainConfig({
        environment: { ...base, STORM_BRAIN_BEARER_TOKEN: "short" },
      }),
    ).rejects.toThrow();
  });

  test("treats empty strings as absent and ignores env overrides for flag-backed models", () => {
    return expect(
      loadBrainConfig({
        environment: {
          ...base,
          PORT: "",
          STORM_BRAIN_DECISIONS_MODEL: "gpt-99",
          DECISIONS_MODEL: "gpt-99",
        },
      }),
    ).resolves.toMatchObject({
      model: "gpt-6-luna",
      decisionsModel: "gpt-6-luna",
      port: 3000,
    });
  });

  test("rejects unknown models, non-decisions models, invalid flag values, and clashing ports", async () => {
    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async (key) =>
            key.key === "model" ? { value: "gpt-99" } : undefined,
        },
      }),
    ).rejects.toThrow(/Unknown model id/);

    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async (key) =>
            key.key === "decisionsModel" ? { value: "gpt-99" } : undefined,
        },
      }),
    ).rejects.toThrow(/Unknown model id/);

    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async (key) =>
            key.key === "decisionsModel" ? { value: "gpt-5.6-sol" } : undefined,
        },
      }),
    ).rejects.toThrow(/not decisions/);

    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async (key) =>
            key.key === "decisionsModel" ? { value: "" } : undefined,
        },
      }),
    ).rejects.toThrow();

    await expect(
      loadBrainConfig({
        environment: { ...base, PORT: "3000", METRICS_PORT: "3000" },
      }),
    ).rejects.toThrow(/must differ/);
  });

  test("selects generative and decisions models independently and falls back on non-fatal source failure", async () => {
    const seenFlags: string[] = [];
    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async (key) => {
            seenFlags.push(`${key.key}:${key.flag}`);
            const overrides: Record<string, { value: string }> = {
              model: { value: "gpt-5.6-sol" },
              decisionsModel: { value: "gpt-6-luna" },
            };
            return overrides[key.key];
          },
        },
      }),
    ).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      decisionsModel: "gpt-6-luna",
    });
    expect(seenFlags).toContain("decisionsModel:storm-brain-decisions-model");

    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async () => {
            throw new Error("flipt snapshot unavailable");
          },
        },
      }),
    ).resolves.toMatchObject({
      model: "gpt-6-luna",
      decisionsModel: "gpt-6-luna",
    });
  });
});
