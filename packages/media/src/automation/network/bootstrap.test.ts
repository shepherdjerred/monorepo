import { afterEach, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createGates } from "./bootstrap.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

function acquisitionSnapshot(enabled: boolean) {
  return {
    ...snapshot,
    flags: snapshot.flags.map((flag) =>
      flag.key === "plain-on"
        ? { ...flag, key: "media-acquisition-enabled", enabled }
        : flag,
    ),
  };
}

test("acquisition requires a fresh enabled flag on every check", async () => {
  const enabled = {
    kind: "snapshot",
    body: acquisitionSnapshot(true),
  } as const;
  const fake = createFakeFetcher(enabled);
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
  const gates = createGates("production");

  await expect(gates.acquisition()).resolves.toBe(true);
  fake.setBehavior({ kind: "snapshot", body: acquisitionSnapshot(false) });
  await expect(gates.acquisition()).resolves.toBe(false);

  fake.setBehavior(enabled);
  await expect(gates.acquisition()).resolves.toBe(true);
  fake.setBehavior({ kind: "network-error", message: "offline" });
  await expect(gates.acquisition()).resolves.toBe(false);

  fake.setBehavior(enabled);
  await expect(gates.acquisition()).resolves.toBe(true);
});

test("acquisition stays closed if the flag provider is disabled", async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  const gates = createGates("production");

  await expect(gates.acquisition()).resolves.toBe(false);
  await expect(gates.subtitleMaintenance()).resolves.toBe(true);
});
