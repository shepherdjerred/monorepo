import { afterEach, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { createToggleableFlagProvider } from "#infrastructure/flags/flag-test-provider.ts";

const key = "media-plex-event-hints-enabled";
afterEach(async () => {
  await shutdownFeatureFlags();
});
test("event hints default off when provider is disabled", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  expect(
    await mediaBehaviorConfig("production", true).get("plexEventHintsEnabled"),
  ).toMatchObject({ value: false, source: "default" });
});
test.each([false, true])(
  "event flag %s is authoritative with explicit media/stage context",
  async (value) => {
    const provider = new StaticProvider({ [key]: value });
    const resolve = vi.spyOn(provider, "resolveBooleanEvaluation");
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider,
    });
    expect(
      await mediaBehaviorConfig("beta").get("plexEventHintsEnabled"),
    ).toMatchObject({ value, source: "flag" });
    expect(resolve.mock.calls[0]?.slice(0, 3)).toEqual([
      key,
      false,
      expect.objectContaining({ targetingKey: "media", stage: "beta" }),
    ]);
  },
);
test("malformed present value and missing active flag fail loudly", async () => {
  for (const flags of [{ [key]: "true" }, {}]) {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider(flags),
    });
    await expect(
      mediaBehaviorConfig("production").get("plexEventHintsEnabled"),
    ).rejects.toThrow();
    await shutdownFeatureFlags();
  }
});
test("fresh flag source outage cannot reuse prior enabled snapshot", async () => {
  const { provider, disconnect } = createToggleableFlagProvider(key);
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider,
  });
  expect(
    await mediaBehaviorConfig("production", true).get("plexEventHintsEnabled"),
  ).toMatchObject({ value: true, source: "flag" });
  disconnect();
  expect(
    await mediaBehaviorConfig("production", true).get("plexEventHintsEnabled"),
  ).toMatchObject({ value: false, source: "default" });
});
