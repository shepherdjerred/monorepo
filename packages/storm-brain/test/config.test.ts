import { describe, expect, test } from "vitest";
import { loadBrainConfig } from "#src/config.ts";

const base = {
  STORM_BRAIN_BEARER_TOKEN: "a-bearer-token-that-is-long-enough!!",
};

describe("storm-brain config", () => {
  test("loads defaults", () => {
    const config = loadBrainConfig({ environment: { ...base } });
    return expect(config).resolves.toMatchObject({
      model: "gpt-5.6-luna",
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

  test("treats empty strings as absent", () => {
    return expect(
      loadBrainConfig({
        environment: { ...base, PORT: "" },
      }),
    ).resolves.toMatchObject({ model: "gpt-5.6-luna", port: 3000 });
  });

  test("rejects unknown models and clashing ports", async () => {
    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async () => ({ value: "gpt-99" }),
        },
      }),
    ).rejects.toThrow(/Unknown model id/);
    await expect(
      loadBrainConfig({
        environment: { ...base, PORT: "3000", METRICS_PORT: "3000" },
      }),
    ).rejects.toThrow(/must differ/);
  });

  test("selects the model through the managed config flag", async () => {
    await expect(
      loadBrainConfig({
        environment: { ...base },
        flagSource: {
          name: "flag",
          get: async () => ({ value: "gpt-5.6-sol" }),
        },
      }),
    ).resolves.toMatchObject({ model: "gpt-5.6-sol" });
  });
});
