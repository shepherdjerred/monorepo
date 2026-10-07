import { afterEach, describe, expect, it } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  homeDashboardConfig,
  petDashboardEnabled,
  shutdownDynamicConfig,
} from "../dynamic-config.ts";
import { loadConfig } from "../config.ts";

const DISABLED_ENVIRONMENT = { FEATURE_FLAGS_MODE: "disabled" } as const;

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("home dashboard entity configuration", () => {
  const config = loadConfig({ TRMNL_API_KEY: "test", HA_TOKEN: "test" });

  it("preserves existing tiles when the provider is unavailable", async () => {
    await initializeDynamicConfig({ environment: DISABLED_ENVIRONMENT });
    const result = await homeDashboardConfig(config);
    expect(result.homeAssistant.presence).toHaveLength(3);
    expect(result.homeAssistant.security).toHaveLength(4);
    expect(result.homeAssistant.climate).toHaveLength(6);
    expect(result.homeAssistant.token).toBe(config.homeAssistant.token);
  });

  it("uses explicit empty selections and parses labels", async () => {
    await initializeDynamicConfig({
      environment: DISABLED_ENVIRONMENT,
      provider: new StaticProvider({
        "trmnl-ha-presence-entities": "",
        "trmnl-ha-security-entities": "lock.door:Door",
        "trmnl-ha-climate-entities": "",
      }),
    });
    const result = await homeDashboardConfig(config);
    expect(result.homeAssistant.presence).toEqual([]);
    expect(result.homeAssistant.security).toEqual([
      { entityId: "lock.door", label: "Door" },
    ]);
    expect(result.homeAssistant.climate).toEqual([]);
  });

  it("rejects malformed present entity selections", async () => {
    await initializeDynamicConfig({
      environment: DISABLED_ENVIRONMENT,
      provider: new StaticProvider({
        "trmnl-ha-presence-entities": ":Missing ID",
        "trmnl-ha-security-entities": "",
        "trmnl-ha-climate-entities": "",
      }),
    });
    await expect(homeDashboardConfig(config)).rejects.toThrow();
  });
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
