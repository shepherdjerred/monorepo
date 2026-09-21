import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  addFlagOverride,
  getFlag,
  isPolicyEnabled,
  listGuildsWithFlagDeclared,
  listGuildsWithFlagEnabled,
  ME,
  MY_SERVER,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const SOMEONE = DiscordAccountIdSchema.parse("160509172704739399");
const originalEnvironment = Bun.env["ENVIRONMENT"];
const PRODUCTION_DENIED_FLAGS = [
  "betting_enabled",
  "betting_player_bet_outcome_dm_enabled",
  "betting_settlement_dm_enabled",
  "bucks_transfers_enabled",
  "bucks_dares_enabled",
  "dare_v2",
  "dare_extended_contracts_enabled",
  "dare_notifications_enabled",
  "custom_nights_enabled",
  "duels_enabled",
  "voice_assistant_enabled",
] as const;

/**
 * Surfaces the policy deliberately does NOT deny: they are beta today by
 * ordinary flag state, so production access is a Flipt decision. Without this
 * list the denial test passes just as well when the policy denies everything.
 */
const PRODUCTION_ALLOWED_FLAGS = [
  "ai_reports_enabled",
  "ai_reports_unlimited",
  "ai_reviews_enabled",
  "challenge_runs_enabled",
  "clash_surface",
  "competition_builder_v2_enabled",
  "explore_on_demand_riot_enabled",
  "hall_of_fame_enabled",
  "mvp_votes_enabled",
  "scoutql_relational_enabled",
] as const;

beforeEach(() => {
  Bun.env["ENVIRONMENT"] = "beta";
  resetConfigurationForTests();
});

afterEach(() => {
  // The registry is process-wide. Restoring rather than clearing keeps this
  // file from switching `debug` off for every test that runs after it.
  resetFlagOverrides("debug");
  resetFlagOverrides("initial_match_history_import_enabled");
  for (const flag of PRODUCTION_DENIED_FLAGS) {
    resetFlagOverrides(flag);
  }
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

describe("production hard-disable policy", () => {
  test("wins over local overrides and guild enumeration", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();

    for (const flag of PRODUCTION_DENIED_FLAGS) {
      expect(getFlag(flag, { server: MY_SERVER, user: SOMEONE })).toBe(false);
      expect(listGuildsWithFlagEnabled(flag)).toEqual([]);
      expect(listGuildsWithFlagDeclared(flag)).toEqual([]);
    }
  });

  test("wins over affirmative provider answers", async () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        betting_enabled: true,
        betting_player_bet_outcome_dm_enabled: true,
        betting_settlement_dm_enabled: true,
        bucks_transfers_enabled: true,
        bucks_dares_enabled: true,
        dare_v2: true,
        dare_extended_contracts_enabled: true,
        dare_notifications_enabled: true,
        custom_nights_enabled: true,
        duels_enabled: true,
        voice_assistant_enabled: true,
      }),
    });

    for (const flag of PRODUCTION_DENIED_FLAGS) {
      await expect(
        isPolicyEnabled(flag, { server: MY_SERVER, user: SOMEONE }),
      ).resolves.toBe(false);
    }
    await shutdownFeatureFlags();
  });

  test("drops beta rollouts from the production fallback", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();

    for (const flag of PRODUCTION_ALLOWED_FLAGS) {
      expect(getFlag(flag, { server: MY_SERVER, user: ME })).toBe(false);
      expect(listGuildsWithFlagEnabled(flag)).toEqual([]);
    }
  });

  test("fails native-client ingress closed without the production provider", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();

    expect(getFlag("scout_client_ingestion", { user: ME })).toBe(false);
    expect(getFlag("scout_client_ingestion", { user: SOMEONE })).toBe(false);
  });

  test("keeps those same beta rollouts outside production", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();

    expect(getFlag("hall_of_fame_enabled", { server: MY_SERVER })).toBe(true);
    expect(getFlag("mvp_votes_enabled", { server: MY_SERVER })).toBe(true);
    expect(getFlag("challenge_runs_enabled", { server: MY_SERVER })).toBe(true);
    expect(getFlag("clash_surface", { server: MY_SERVER })).toBe(true);
    expect(getFlag("custom_nights_enabled", { server: MY_SERVER })).toBe(true);
    expect(getFlag("ai_reports_unlimited", { user: ME })).toBe(true);
    expect(listGuildsWithFlagEnabled("hall_of_fame_enabled")).toEqual([
      MY_SERVER,
    ]);
    expect(getFlag("scout_client_ingestion", { user: ME })).toBe(false);
    expect(getFlag("scout_client_ingestion", { user: SOMEONE })).toBe(false);
  });

  test("leaves every other surface to its ordinary flag", async () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({
        ai_reports_enabled: true,
        ai_reports_unlimited: true,
        ai_reviews_enabled: true,
        challenge_runs_enabled: true,
        clash_surface: true,
        competition_builder_v2_enabled: true,
        explore_on_demand_riot_enabled: true,
        hall_of_fame_enabled: true,
        mvp_votes_enabled: true,
        scoutql_relational_enabled: true,
      }),
    });

    for (const flag of PRODUCTION_ALLOWED_FLAGS) {
      await expect(
        isPolicyEnabled(flag, { server: MY_SERVER, user: SOMEONE }),
      ).resolves.toBe(true);
    }
    await shutdownFeatureFlags();
  });
});

describe("Bryan Bucks settlement DM flags", () => {
  test("are off by default and enabled only for the beta guild", () => {
    expect(
      getFlag("betting_settlement_dm_enabled", { server: OTHER_GUILD }),
    ).toBe(false);
    expect(
      getFlag("betting_player_bet_outcome_dm_enabled", {
        server: OTHER_GUILD,
      }),
    ).toBe(false);
    expect(
      getFlag("betting_settlement_dm_enabled", { server: MY_SERVER }),
    ).toBe(true);
    expect(
      getFlag("betting_player_bet_outcome_dm_enabled", { server: MY_SERVER }),
    ).toBe(true);
  });
});

describe("Bryan Bucks transfer flag", () => {
  test("is off by default and enabled only for the beta guild", () => {
    expect(getFlag("bucks_transfers_enabled", { server: OTHER_GUILD })).toBe(
      false,
    );
    expect(getFlag("bucks_transfers_enabled", { server: MY_SERVER })).toBe(
      true,
    );
  });
});

describe("Bryan Bucks dare flag", () => {
  test("is off by default and enabled only for the beta guild", () => {
    expect(getFlag("bucks_dares_enabled", { server: OTHER_GUILD })).toBe(false);
    expect(getFlag("bucks_dares_enabled", { server: MY_SERVER })).toBe(true);
  });
});

describe("initial history import flag", () => {
  test("is default-off and can target one guild in production", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    expect(
      getFlag("initial_match_history_import_enabled", {
        server: OTHER_GUILD,
      }),
    ).toBe(false);

    addFlagOverride("initial_match_history_import_enabled", true, {
      server: OTHER_GUILD,
    });
    expect(
      getFlag("initial_match_history_import_enabled", {
        server: OTHER_GUILD,
      }),
    ).toBe(true);
    resetFlagOverrides("initial_match_history_import_enabled");
  });
});

describe("competition builder V2 rollout", () => {
  test("is off by default and enabled for the beta guild", () => {
    expect(
      getFlag("competition_builder_v2_enabled", { server: OTHER_GUILD }),
    ).toBe(false);
    expect(
      getFlag("competition_builder_v2_enabled", { server: MY_SERVER }),
    ).toBe(true);
  });
});

describe("listGuildsWithFlagEnabled", () => {
  test("returns the guild a flag is switched on for", () => {
    // Reset first: another test file may have cleared this flag, and the
    // registry is shared across the whole process.
    resetFlagOverrides("betting_enabled");
    expect(listGuildsWithFlagEnabled("betting_enabled")).toEqual([MY_SERVER]);
  });

  test("follows the registry when a second guild is enabled", () => {
    // The point of deriving this from the registry rather than hard-coding it:
    // enabling a flag somewhere new registers the command there with no second
    // edit.
    addFlagOverride("debug", true, { server: OTHER_GUILD });
    expect(listGuildsWithFlagEnabled("debug")).toContain(OTHER_GUILD);
  });

  test("ignores an override that only enables a flag for one person", () => {
    // `{ server, user }` means one member has it, not that the guild does —
    // registering a command for everyone there on that basis would be wrong.
    addFlagOverride("debug", true, { server: OTHER_GUILD, user: SOMEONE });

    expect(listGuildsWithFlagEnabled("debug")).not.toContain(OTHER_GUILD);
    expect(getFlag("debug", { server: OTHER_GUILD, user: SOMEONE })).toBe(true);
    expect(getFlag("debug", { server: OTHER_GUILD })).toBe(false);
  });

  test("ignores an override that switches a flag off", () => {
    addFlagOverride("debug", false, { server: OTHER_GUILD });
    expect(listGuildsWithFlagEnabled("debug")).not.toContain(OTHER_GUILD);
  });

  test("does not repeat a guild listed twice", () => {
    addFlagOverride("debug", true, { server: OTHER_GUILD });
    addFlagOverride("debug", true, { server: OTHER_GUILD });
    const guilds = listGuildsWithFlagEnabled("debug");
    expect(guilds.filter((guild) => guild === OTHER_GUILD)).toHaveLength(1);
  });

  test("every returned guild actually reads as enabled", () => {
    resetFlagOverrides("betting_enabled");
    for (const guild of listGuildsWithFlagEnabled("betting_enabled")) {
      expect(getFlag("betting_enabled", { server: guild })).toBe(true);
    }
  });

  // Not tested: the throw for a flag that defaults to true. Every flag in the
  // registry defaults to false and there is no public way to change a default,
  // so any test here would be asserting against a flag that cannot exist. The
  // guard stays because returning [] for such a flag would quietly unregister
  // its command everywhere, which is far worse than a loud failure.
});

describe("listGuildsWithFlagDeclared", () => {
  test("returns the guild a flag is switched on for", () => {
    resetFlagOverrides("betting_enabled");
    expect(listGuildsWithFlagDeclared("betting_enabled")).toEqual([MY_SERVER]);
  });

  // The whole reason this exists next to `listGuildsWithFlagEnabled`. Guild
  // command registration is a PUT that REPLACES a guild's command list, so a
  // guild whose flag was switched off has to stay in the reconciliation set —
  // visiting only the enabled guilds leaves Discord serving the command there
  // forever.
  test("keeps a guild whose override switches the flag off", () => {
    addFlagOverride("debug", false, { server: OTHER_GUILD });

    expect(listGuildsWithFlagEnabled("debug")).not.toContain(OTHER_GUILD);
    expect(listGuildsWithFlagDeclared("debug")).toContain(OTHER_GUILD);
  });

  test("is a superset of the enabled list", () => {
    addFlagOverride("debug", true, { server: MY_SERVER });
    addFlagOverride("debug", false, { server: OTHER_GUILD });

    const declared = listGuildsWithFlagDeclared("debug");
    for (const guild of listGuildsWithFlagEnabled("debug")) {
      expect(declared).toContain(guild);
    }
  });

  test("ignores an override scoped to one person in a guild", () => {
    // Same rule as the enabled list: `{ server, user }` says something about a
    // member, not about the guild, so it must not pull the guild into a
    // reconciliation that would clear that guild's commands.
    addFlagOverride("debug", false, { server: OTHER_GUILD, user: SOMEONE });
    expect(listGuildsWithFlagDeclared("debug")).not.toContain(OTHER_GUILD);
  });

  test("does not repeat a guild declared twice", () => {
    addFlagOverride("debug", true, { server: OTHER_GUILD });
    addFlagOverride("debug", false, { server: OTHER_GUILD });
    const guilds = listGuildsWithFlagDeclared("debug");
    expect(guilds.filter((guild) => guild === OTHER_GUILD)).toHaveLength(1);
  });
});

describe("isPolicyEnabled", () => {
  afterEach(async () => {
    await shutdownFeatureFlags();
  });

  test("a resolved false stops the local guild fallback", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new StaticProvider({ betting_enabled: false }),
    });

    // The static provider's resolved false must stop the local beta fallback;
    // this catches the dangerous false-is-absence regression.
    await expect(
      isPolicyEnabled("betting_enabled", { server: MY_SERVER }),
    ).resolves.toBe(false);
  });

  test("keeps targeted fail-closed defaults when the provider is unavailable", async () => {
    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
    });

    await expect(
      isPolicyEnabled("ai_reports_enabled", { server: OTHER_GUILD }),
    ).resolves.toBe(false);
    await expect(
      isPolicyEnabled("ai_reports_enabled", { server: MY_SERVER }),
    ).resolves.toBe(true);
  });
});
