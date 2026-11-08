import { afterEach, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { mediaBehaviorConfig } from "#infrastructure/config.ts";

const key = "media-capacity-observation-enabled";
afterEach(async () => {
  await shutdownFeatureFlags();
});
test("disabled provider uses explicit default false provenance", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  expect(
    await mediaBehaviorConfig("production", true).get(
      "capacityObservationEnabled",
    ),
  ).toMatchObject({ value: false, source: "default" });
});
test.each([false, true])(
  "capacity %s resolves as flag with media/stage targeting",
  async (value) => {
    const provider = new StaticProvider({ [key]: value });
    const resolve = vi.spyOn(provider, "resolveBooleanEvaluation");
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider,
    });
    expect(
      await mediaBehaviorConfig("beta").get("capacityObservationEnabled"),
    ).toMatchObject({ value, source: "flag" });
    expect(resolve.mock.calls[0]?.slice(0, 3)).toEqual([
      key,
      false,
      expect.objectContaining({ targetingKey: "media", stage: "beta" }),
    ]);
  },
);
test("invalid present boolean and active missing key fail instead of inventing capacity", async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({ [key]: "true" }),
  });
  await expect(
    mediaBehaviorConfig("production").get("capacityObservationEnabled"),
  ).rejects.toThrow();
  await shutdownFeatureFlags();
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({}),
  });
  await expect(
    mediaBehaviorConfig("production").get("capacityObservationEnabled"),
  ).rejects.toThrow();
});
test("fresh snapshot failure returns default false without using cached true", async () => {
  const fake = createFakeFetcher({
    kind: "snapshot",
    body: {
      ...snapshot,
      flags: snapshot.flags.map((flag) => ({
        ...flag,
        key: flag.key === "plain-on" ? key : flag.key,
      })),
    },
  });
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new FliptProvider({
      url: "http://flipt.invalid:8080",
      namespace: "default",
      environment: "default",
      pollIntervalSeconds: 300,
      fetcher: fake.fetcher,
    }),
  });
  expect(
    await mediaBehaviorConfig("production", true).get(
      "capacityObservationEnabled",
    ),
  ).toMatchObject({ value: true, source: "flag" });
  fake.setBehavior({ kind: "network-error", message: "offline" });
  expect(
    await mediaBehaviorConfig("production", true).get(
      "capacityObservationEnabled",
    ),
  ).toMatchObject({ value: false, source: "default" });
});
