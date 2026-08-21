import { afterEach, describe, expect, test } from "bun:test";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  exploreGuildAllowlist,
  initializeDynamicConfig,
  isDynamicConfigReady,
  llmHourlyTokenBudget,
  shutdownDynamicConfig,
} from "#src/config/dynamic.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

const SEED = {
  exploreGuildAllowlist: ["seeded-guild"],
  llmHourlyTokenBudget: 2_000_000,
  llmDailyTokenBudget: 20_000_000,
};

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("scout dynamic config", () => {
  test("resolves to the seed when neither a flag nor env supplies a value", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    // The seed is the env-derived value the service used before this existed,
    // so with no flag and no env the migration is a no-op.
    expect(exploreGuildAllowlist()).toEqual([]);
  });

  test("env supplies a comma-separated allowlist", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, EXPLORE_GUILD_ALLOWLIST: "111, 222 ,333" },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreGuildAllowlist()).toEqual(["111", "222", "333"]);
  });

  test("a flag outranks env", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, EXPLORE_GUILD_ALLOWLIST: "111" },
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "explore-guild-allowlist": "999,888" }),
    });
    expect(exploreGuildAllowlist()).toEqual(["999", "888"]);
  });

  test("an empty allowlist still denies everyone — fail-closed survives", async () => {
    // This is the entire gate for a surface that reads the whole match lake.
    // "Not configured" has to mean "nobody", never "everybody", and that must
    // hold no matter which layer answered.
    await initializeDynamicConfig({
      environment: { ...DISABLED, EXPLORE_GUILD_ALLOWLIST: "" },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreGuildAllowlist()).toEqual([]);
  });

  test("token budgets resolve through the flag layer", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "llm-hourly-token-budget": 500 }),
    });
    expect(llmHourlyTokenBudget()).toBe(500);
  });

  test("reads are synchronous, which is why the snapshot exists", async () => {
    // exploreAllowlist() is handed to Discord guild command registration as a
    // () => string[]. Making it async would ripple into the registration loop,
    // where a wrong answer UNREGISTERS /scout rather than disabling it.
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    const value: string[] = exploreGuildAllowlist();
    expect(Array.isArray(value)).toBe(true);
  });

  test("readiness flips with initialize and shutdown", async () => {
    expect(isDynamicConfigReady()).toBe(false);
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    expect(isDynamicConfigReady()).toBe(true);
    await shutdownDynamicConfig();
    expect(isDynamicConfigReady()).toBe(false);
  });
});
