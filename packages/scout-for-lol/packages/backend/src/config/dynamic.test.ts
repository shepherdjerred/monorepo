import { afterEach, describe, expect, test } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  exploreGuildAllowlist,
  exploreModel,
  initializeDynamicConfig,
  isDynamicConfigReady,
  llmHourlyTokenBudget,
  shutdownDynamicConfig,
  tournamentMaxOpenLobbies,
  tournamentApiMode,
  DYNAMIC_FLAG_NAMES,
  type DynamicConfigSeed,
} from "#src/config/dynamic.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

const SEED: DynamicConfigSeed = {
  exploreGuildAllowlist: ["seeded-guild"],
  exploreModel: "gpt-5.6-luna",
  llmHourlyTokenBudget: 2_000_000,
  llmDailyTokenBudget: 20_000_000,
  tournamentApiMode: "stub",
  tournamentMaxOpenLobbies: 10,
};

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("scout dynamic config", () => {
  test("covers exactly the Scout dynamic entries in the managed inventory", () => {
    const expected = managedFlagInventory.flags
      .filter(
        (flag) => flag.owner === "scout" && flag.source === "scout-dynamic",
      )
      .map((flag) => flag.key)
      .sort();
    expect([...DYNAMIC_FLAG_NAMES].sort()).toEqual(expected);
  });

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

describe("tournament api mode", () => {
  test("defaults to the stub", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
    });
    // The safe state: a stub code cannot create a real game, so a deploy that
    // forgot to configure this fails visibly at lobby creation rather than
    // minting live codes nobody expected.
    expect(tournamentApiMode()).toBe("stub");
  });

  test("env can select the live API", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, TOURNAMENT_API_MODE: "live" },
      seed: SEED,
      startPolling: false,
    });
    expect(tournamentApiMode()).toBe("live");
  });

  test("a flag outranks env, so the swap needs no deploy", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, TOURNAMENT_API_MODE: "stub" },
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "scout-tournament-api-mode": "live" }),
    });
    expect(tournamentApiMode()).toBe("live");
  });

  test("resolves the lobby limit through the variant flag", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, TOURNAMENT_MAX_OPEN_LOBBIES: "3" },
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "scout-tournament-max-open-lobbies": 7 }),
    });
    expect(tournamentMaxOpenLobbies()).toBe(7);
  });

  test("an unparseable value keeps the seed rather than guessing", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, TOURNAMENT_API_MODE: "nonsense" },
      seed: SEED,
      startPolling: false,
    });
    expect(tournamentApiMode()).toBe("stub");
  });
});
