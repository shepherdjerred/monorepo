import { afterEach, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { mediaBehaviorConfig } from "./config.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

test("unavailable flags keep every media effect gate closed", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  const config = mediaBehaviorConfig("production");
  for (const key of [
    "requestsEnabled",
    "acquisitionEnabled",
    "sourceCleanupEnabled",
    "quarantineEnabled",
    "purgeEnabled",
  ] as const) {
    expect(await config.get(key)).toMatchObject({ value: false });
  }
  expect(await config.get("keepDays")).toMatchObject({ value: 30 });
});

test("a resolved false stays authoritative independently of another enabled gate", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      "media-acquisition-enabled": true,
      "media-purge-enabled": false,
    }),
  });
  const config = mediaBehaviorConfig("beta");
  expect(await config.get("acquisitionEnabled")).toMatchObject({ value: true });
  expect(await config.get("purgeEnabled")).toMatchObject({ value: false });
});

test.each(["0", "-1", "366", "not-a-number"])(
  "present invalid Keep duration %s fails instead of falling back",
  async (value) => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ "media-keep-days": value }),
    });
    await expect(
      mediaBehaviorConfig("production").get("keepDays"),
    ).rejects.toThrow();
  },
);

test("invalid boolean values fail instead of enabling effects", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({ "media-purge-enabled": "true" }),
  });
  await expect(
    mediaBehaviorConfig("production").get("purgeEnabled"),
  ).rejects.toThrow();
});
