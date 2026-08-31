import { afterEach, describe, expect, it } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  petDashboardEnabled,
  shutdownDynamicConfig,
} from "../dynamic-config.ts";

const DISABLED_ENVIRONMENT = { FEATURE_FLAGS_MODE: "disabled" } as const;

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("pet dashboard feature flag", () => {
  it("defaults off when the flag backend has no opinion", async () => {
    await initializeDynamicConfig({ environment: DISABLED_ENVIRONMENT });

    await expect(petDashboardEnabled()).resolves.toBe(false);
  });

  it("enables the route from the managed flag", async () => {
    await initializeDynamicConfig({
      environment: DISABLED_ENVIRONMENT,
      provider: new StaticProvider({ "pet-dashboard-enabled": true }),
    });

    await expect(petDashboardEnabled()).resolves.toBe(true);
  });
});
