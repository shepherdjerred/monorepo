import { describe, expect, test } from "vitest";
import { loadBrainConfig } from "#src/config.ts";

const base = {
  STORM_BRAIN_BEARER_TOKEN: "a-bearer-token-that-is-long-enough!!",
};

describe("storm-brain config", () => {
  test("loads defaults", () => {
    const config = loadBrainConfig({ ...base });
    expect(config.model).toBe("gpt-5.6-luna");
    expect(config.maxBodyBytes).toBe(262_144);
    expect(config.llmTimeoutMs).toBe(60_000);
    expect(config.port).toBe(3000);
    expect(config.metricsPort).toBe(9090);
  });

  test("requires STORM_BRAIN_BEARER_TOKEN", () => {
    expect(() => loadBrainConfig({})).toThrow(/STORM_BRAIN_BEARER_TOKEN/);
  });

  test("rejects short bearer tokens", () => {
    expect(() =>
      loadBrainConfig({ ...base, STORM_BRAIN_BEARER_TOKEN: "short" }),
    ).toThrow();
  });

  test("treats empty strings as absent", () => {
    const config = loadBrainConfig({
      ...base,
      STORM_BRAIN_MODEL: "",
      PORT: "",
    });
    expect(config.model).toBe("gpt-5.6-luna");
    expect(config.port).toBe(3000);
  });

  test("rejects unknown models and clashing ports", () => {
    expect(() =>
      loadBrainConfig({ ...base, STORM_BRAIN_MODEL: "gpt-99" }),
    ).toThrow(/Unknown model id/);
    expect(() =>
      loadBrainConfig({ ...base, PORT: "3000", METRICS_PORT: "3000" }),
    ).toThrow(/must differ/);
  });
});
