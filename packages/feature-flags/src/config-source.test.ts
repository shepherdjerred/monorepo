import { afterEach, describe, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags/index.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

const NAMES = { key: "featureOn", flag: "ai_reports_enabled" } as const;

describe("flag config source", () => {
  test("a resolved flag answers with its value", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toEqual({ value: true });
  });

  test("a flag resolving FALSE answers — it does not report absence", async () => {
    // The composition-level statement of the same property the provider tests
    // assert: this is what stops the resolver descending to a stale env var.
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: false }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toEqual({ value: false });
  });

  test("an undefined flag in provider throws so the resolver does not silently descend", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({}),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).rejects.toThrow(/evaluation failed/);
  });

  test("an unavailable provider reports absence so the resolver descends", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toBeUndefined();
  });

  test("a key with no declared kind is never asked of the flag layer", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ ai_reports_enabled: true }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: {},
    });
    await expect(source.get(NAMES)).resolves.toBeUndefined();
  });

  test("resolves string and number kinds", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "scout-report-ai-model": "gpt-5.6-sol",
        "llm-hourly-token-budget": 0.33,
      }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { model: "string", threshold: "number" },
    });
    await expect(
      source.get({ key: "model", flag: "scout-report-ai-model" }),
    ).resolves.toEqual({
      value: "gpt-5.6-sol",
    });
    await expect(
      source.get({ key: "threshold", flag: "llm-hourly-token-budget" }),
    ).resolves.toEqual({ value: 0.33 });
  });

  test("a non-absence evaluation error is surfaced", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        ai_reports_enabled: "not-a-boolean",
      }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).rejects.toThrow(/TYPE_MISMATCH/);
  });
});
