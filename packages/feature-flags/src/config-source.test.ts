import { afterEach, describe, expect, test } from "bun:test";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags/index.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

const NAMES = { key: "featureOn", flag: "feature-on" } as const;

describe("flag config source", () => {
  test("a resolved flag answers with its value", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ "feature-on": true }),
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
      provider: new StaticProvider({ "feature-on": false }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { featureOn: "boolean" },
    });
    await expect(source.get(NAMES)).resolves.toEqual({ value: false });
  });

  test("an undefined flag reports absence so the resolver descends", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({}),
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
      provider: new StaticProvider({ "feature-on": true }),
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
      provider: new StaticProvider({ model: "gpt-5.6-sol", threshold: 0.33 }),
    });
    const source = createFlagConfigSource({
      targetingKey: "service",
      kinds: { model: "string", threshold: "number" },
    });
    await expect(source.get({ key: "model", flag: "model" })).resolves.toEqual({
      value: "gpt-5.6-sol",
    });
    await expect(
      source.get({ key: "threshold", flag: "threshold" }),
    ).resolves.toEqual({ value: 0.33 });
  });
});
