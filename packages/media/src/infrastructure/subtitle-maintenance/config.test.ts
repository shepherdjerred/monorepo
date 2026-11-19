import { afterEach, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";
afterEach(async () => {
  await shutdownFeatureFlags();
});
test("recurring personal subtitle maintenance defaults on with default provenance", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  await expect(
    mediaBehaviorConfig("production").get("subtitleMaintenanceEnabled"),
  ).resolves.toEqual({ value: true, source: "default" });
});
test.each([true, false])(
  "typed subtitle maintenance flag uses explicit %s with flag provenance",
  async (value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        "media-subtitle-maintenance-enabled": value,
      }),
    });
    await expect(
      mediaBehaviorConfig("production").get("subtitleMaintenanceEnabled"),
    ).resolves.toEqual({ value, source: "flag" });
  },
);
test("invalid maintenance flag value fails rather than silently enabling", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      "media-subtitle-maintenance-enabled": "sometimes",
    }),
  });
  await expect(
    mediaBehaviorConfig("production").get("subtitleMaintenanceEnabled"),
  ).rejects.toThrow();
});
