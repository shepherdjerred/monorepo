import { afterEach, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import { createFakeFetcher } from "@shepherdjerred/feature-flags/providers/fake-fetcher.ts";
import snapshot from "@shepherdjerred/feature-flags/providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { reportLakeSchemaUpgradeEnabled } from "./report-lake-schema-upgrade.ts";

afterEach(async () => {
  await shutdownFeatureFlags();
});

test("defaults off before initialization and with a disabled provider", async () => {
  expect(await reportLakeSchemaUpgradeEnabled()).toBe(false);
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  expect(await reportLakeSchemaUpgradeEnabled()).toBe(false);
});

test("an active provider missing the declared flag fails loudly", async () => {
  const fake = createFakeFetcher({ kind: "snapshot", body: snapshot });
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
  await expect(reportLakeSchemaUpgradeEnabled()).rejects.toThrow();
});

test.each([false, true])(
  "uses a fresh authoritative %s without env overrides",
  async (enabled) => {
    const fake = createFakeFetcher({
      kind: "snapshot",
      body: {
        ...snapshot,
        flags: snapshot.flags.map((flag) =>
          flag.key === "plain-on"
            ? {
                ...flag,
                key: "scout-report-lake-schema-upgrade-enabled",
                enabled,
              }
            : flag,
        ),
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
    expect(await reportLakeSchemaUpgradeEnabled()).toBe(enabled);
    fake.setBehavior({ kind: "network-error", message: "offline" });
    expect(await reportLakeSchemaUpgradeEnabled()).toBe(false);
    fake.setBehavior({
      kind: "snapshot",
      body: { invalid: "successful response" },
    });
    await expect(reportLakeSchemaUpgradeEnabled()).rejects.toThrow(
      "contract invalid",
    );
  },
);
