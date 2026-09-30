import { afterEach, describe, expect, test } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  exploreGuildAllowlist,
  exploreModel,
  exploreQuotaLimits,
  initializeDynamicConfig,
  isDynamicConfigReady,
  llmHourlyTokenBudget,
  shutdownDynamicConfig,
  temporalCallGraphTracing,
  type DynamicConfigSeed,
} from "#src/config/dynamic.ts";
import { DEFAULT_EXPLORE_QUOTA_LIMITS } from "#src/configuration/explore-quota.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

const SEED: DynamicConfigSeed = {
  exploreGuildAllowlist: ["seeded-guild"],
  exploreQuotaLimits: DEFAULT_EXPLORE_QUOTA_LIMITS,
  exploreModel: "gpt-5.6-luna",
  llmHourlyTokenBudget: 2_000_000,
  llmDailyTokenBudget: 20_000_000,
  temporalCallGraphTracing: false,
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

  test("Explore defaults to Luna and accepts the authoritative flag", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    expect(exploreModel()).toBe("gpt-5.6-luna");
    await shutdownDynamicConfig();

    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({
        "scout-explore-model": "gpt-5.6-terra",
      }),
    });
    expect(exploreModel()).toBe("gpt-5.6-terra");
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

  test("the boot-time call-graph read resolves instead of throwing", async () => {
    // index.ts calls this during startup, before any refresh. `snapshot.get`
    // throws on an unseeded key and the accessor's `?? false` only guards a
    // null snapshot, so an unseeded key kills the backend at boot — it shipped
    // that way once and the scout-for-lol in-image smoke caught it.
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    expect(temporalCallGraphTracing()).toBe(false);
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

describe("explore quota limits", () => {
  test("absence resolves to the shipped policy", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits()).toEqual(DEFAULT_EXPLORE_QUOTA_LIMITS);
  });

  test("env supplies the whole policy as one JSON object", async () => {
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        EXPLORE_QUOTA_LIMITS: JSON.stringify({
          ...DEFAULT_EXPLORE_QUOTA_LIMITS,
          userMinute: 4,
        }),
      },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits().userMinute).toBe(4);
  });

  test("a flag outranks env, so a cost rollback needs no deploy", async () => {
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        EXPLORE_QUOTA_LIMITS: JSON.stringify(DEFAULT_EXPLORE_QUOTA_LIMITS),
      },
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({
        "scout-explore-quota-limits": JSON.stringify({
          ...DEFAULT_EXPLORE_QUOTA_LIMITS,
          userMinute: 1,
          userHour: 2,
        }),
      }),
    });
    expect(exploreQuotaLimits().userMinute).toBe(1);
    expect(exploreQuotaLimits().userHour).toBe(2);
  });

  test("a policy whose windows shrink as they widen is refused", async () => {
    // Not merely strict: the minute rule could never bind, so a refusal would
    // name a window the caller had not actually exhausted.
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        EXPLORE_QUOTA_LIMITS: JSON.stringify({
          ...DEFAULT_EXPLORE_QUOTA_LIMITS,
          userMinute: 500,
        }),
      },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits()).toEqual(DEFAULT_EXPLORE_QUOTA_LIMITS);
  });

  test("a user ceiling above its own global window is refused", async () => {
    // The hourly pair stays valid here on purpose. Checking only that pair —
    // which is what shipped first — let an operator lower the longer global
    // windows and leave a weekly user allowance the global bucket refuses.
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        EXPLORE_QUOTA_LIMITS: JSON.stringify({
          ...DEFAULT_EXPLORE_QUOTA_LIMITS,
          userDay: 5000,
          userWeek: 5000,
        }),
      },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits()).toEqual(DEFAULT_EXPLORE_QUOTA_LIMITS);
  });

  test("a user ceiling above the global one is refused", async () => {
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        EXPLORE_QUOTA_LIMITS: JSON.stringify({
          ...DEFAULT_EXPLORE_QUOTA_LIMITS,
          userHour: 100_000,
          userDay: 100_000,
          userWeek: 100_000,
        }),
      },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits()).toEqual(DEFAULT_EXPLORE_QUOTA_LIMITS);
  });

  test("malformed JSON keeps the seed rather than guessing", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, EXPLORE_QUOTA_LIMITS: "not json" },
      seed: SEED,
      startPolling: false,
    });
    expect(exploreQuotaLimits()).toEqual(DEFAULT_EXPLORE_QUOTA_LIMITS);
  });
});
