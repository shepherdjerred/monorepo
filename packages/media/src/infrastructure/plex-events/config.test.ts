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
    await mediaBehaviorConfig("production", true).get("plexEventHintsEnabled"),
  ).toMatchObject({ value: true, source: "flag" });
  fake.setBehavior({ kind: "network-error", message: "offline" });
  expect(
    await mediaBehaviorConfig("production", true).get("plexEventHintsEnabled"),
  ).toMatchObject({ value: false, source: "default" });
});
