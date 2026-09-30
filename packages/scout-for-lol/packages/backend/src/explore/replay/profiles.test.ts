import { describe, expect, test } from "vitest";
import { EXPLORE_SUGGESTIONS } from "@scout-for-lol/data";
import {
  CapturedGuildConfigSchema,
  EXPLORE_REPLAY_CAPABILITIES,
  capabilityMismatches,
  chipExpectation,
  conditionCapability,
  flagOverridesFor,
  guildConfigIssues,
  type CapturedGuildConfig,
  type ExploreCapabilitySet,
} from "./profiles.ts";

const NOTHING: ExploreCapabilitySet = {
  bucks: false,
  dares: false,
  challenges: false,
  creation: false,
  riotHistory: false,
  mvpVotes: false,
  clash: false,
  hallOfFame: false,
};

const EVERYTHING: ExploreCapabilitySet = {
  bucks: true,
  dares: true,
  challenges: true,
  creation: true,
  riotHistory: false,
  mvpVotes: true,
  clash: true,
  hallOfFame: true,
};

function config(
  overrides: Partial<CapturedGuildConfig> = {},
): CapturedGuildConfig {
  return CapturedGuildConfigSchema.parse({
    guildId: "1337623164146155593",
    label: "mine",
    requesterId: "160509172704739328",
    capabilities: NOTHING,
    capturedAt: "2026-09-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("CapturedGuildConfigSchema", () => {
  test("rejects unknown fields rather than ignoring them", () => {
    expect(() =>
      CapturedGuildConfigSchema.parse({ ...config(), extra: 1 }),
    ).toThrow();
  });

  test("takes exactly one guild, so bucks can never see two", () => {
    // `resolveBucksCapability` throws when more than one betting-enabled guild
    // is in scope; one guild per config makes that structurally impossible.
    const parsed = config();
    expect(typeof parsed.guildId).toBe("string");
  });

  test("rejects a capability set with unknown capabilities", () => {
    expect(() =>
      CapturedGuildConfigSchema.parse({
        ...config(),
        capabilities: { ...NOTHING, telepathy: true },
      }),
    ).toThrow();
  });
});

describe("conditionCapability", () => {
  test("maps feature conditions onto the capability that gates them", () => {
    expect(conditionCapability("bucks")).toBe("bucks");
    expect(conditionCapability("dares")).toBe("dares");
    expect(conditionCapability("challenges")).toBe("challenges");
    // Preparing a competition needs the creation tool; reading one does not.
    expect(conditionCapability("competition_creation")).toBe("creation");
  });

  test("leaves lake-answerable conditions ungated", () => {
    // Gated in the web UI per guild, but the questions are ordinary analytics;
    // demanding a refusal would be wrong.
    expect(conditionCapability("always")).toBeNull();
    expect(conditionCapability("customs")).toBeNull();
    // Reading competitions is a core feature, answered by permission-checked
    // tools every turn has; it used to be graded against creation.
    expect(conditionCapability("competitions")).toBeNull();
    // Off, a record question is still answered from match data, labelled as
    // not the official board.
    expect(conditionCapability("hall_of_fame")).toBeNull();
  });
});

describe("chipExpectation", () => {
  test("ungated conditions are answerable for any guild", () => {
    for (const capabilities of [NOTHING, EVERYTHING]) {
      expect(chipExpectation(capabilities, "always")).toBe("answerable");
      expect(chipExpectation(capabilities, "customs")).toBe("answerable");
      expect(chipExpectation(capabilities, "competitions")).toBe("answerable");
      expect(chipExpectation(capabilities, "hall_of_fame")).toBe("answerable");
    }
  });

  test("a gated condition follows the guild's capabilities", () => {
    // The prod case and the beta case, which is the whole point.
    expect(chipExpectation(NOTHING, "bucks")).toBe("gated-off");
    expect(chipExpectation(EVERYTHING, "bucks")).toBe("answerable");
    expect(chipExpectation(NOTHING, "competition_creation")).toBe("gated-off");
    expect(chipExpectation(EVERYTHING, "competition_creation")).toBe(
      "answerable",
    );
    expect(chipExpectation(NOTHING, "mvp_votes")).toBe("gated-off");
    expect(chipExpectation(EVERYTHING, "mvp_votes")).toBe("answerable");
  });

  test("every shipped condition resolves to an expectation", () => {
    // `CONDITION_CAPABILITY` is exhaustive over `SuggestionCondition`, so a
    // condition added to the catalog cannot reach a run unmapped. This asserts
    // the other half: that the catalog as shipped is fully covered, which is
    // what stops a new chip from being silently ungraded.
    const conditions = new Set(EXPLORE_SUGGESTIONS.map((s) => s.condition));
    for (const condition of conditions) {
      expect(["answerable", "gated-off", "either"]).toContain(
        chipExpectation(EVERYTHING, condition),
      );
    }
  });

  test("asserts nothing for report chips, which legitimately go both ways", () => {
    // Nine of fifteen declined and six answered informatively in the beta
    // sweep, and both were right; an assertion wrong half the time is worse
    // than none.
    expect(chipExpectation(NOTHING, "reports")).toBe("either");
    expect(chipExpectation(EVERYTHING, "reports")).toBe("either");
  });
});

describe("flagOverridesFor", () => {
  test("turns every gate off for a guild with nothing", () => {
    for (const override of flagOverridesFor(NOTHING)) {
      expect(override.value).toBe(false);
    }
  });

  test("sets all three dare flags together", () => {
    // dareExploreEnabled needs (dare_v2 || extended) && scoutql_relational.
    const overrides = flagOverridesFor(EVERYTHING);
    for (const flag of [
      "dare_v2",
      "dare_extended_contracts_enabled",
      "scoutql_relational_enabled",
    ]) {
      expect(overrides.find((entry) => entry.flag === flag)?.value).toBe(true);
    }
  });

  test("never reproduces on-demand Riot reads, whatever was captured", () => {
    const overrides = flagOverridesFor({ ...EVERYTHING, riotHistory: true });
    expect(
      overrides.find((entry) => entry.flag === "explore_on_demand_riot_enabled")
        ?.value,
    ).toBe(false);
  });

  test("covers every capability that has a gate", () => {
    const flags = new Set(flagOverridesFor(EVERYTHING).map((e) => e.flag));
    expect(flags.has("betting_enabled")).toBe(true);
    expect(flags.has("challenge_runs_enabled")).toBe(true);
    expect(flags.has("explore_creation_enabled")).toBe(true);
  });
});

describe("guildConfigIssues", () => {
  test("accepts a guild with nothing and a guild with everything", () => {
    expect(guildConfigIssues(config(), "web")).toEqual([]);
    expect(
      guildConfigIssues(config({ capabilities: EVERYTHING }), "web"),
    ).toEqual([]);
  });

  test("rejects dares without bucks", () => {
    expect(
      guildConfigIssues(
        config({ capabilities: { ...NOTHING, dares: true } }),
        "web",
      ),
    ).toEqual([expect.stringContaining("dares resolve from a bucks")]);
  });

  test("rejects creation off the web surface", () => {
    expect(
      guildConfigIssues(
        config({ capabilities: { ...NOTHING, creation: true } }),
        "discord",
      ),
    ).toEqual([expect.stringContaining("creation tools are web-only")]);
  });

  test("rejects a captured riotHistory, which replay never reproduces", () => {
    expect(
      guildConfigIssues(
        config({ capabilities: { ...NOTHING, riotHistory: true } }),
        "web",
      ),
    ).toEqual([expect.stringContaining("never reproduced")]);
  });
});

describe("capabilityMismatches", () => {
  test("is empty when the turn resolved what was captured", () => {
    expect(
      capabilityMismatches({ config: config(), resolved: NOTHING }),
    ).toEqual([]);
  });

  test("names the capability, the guild and the direction", () => {
    const issues = capabilityMismatches({
      config: config(),
      resolved: { ...NOTHING, bucks: true },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("bucks");
    expect(issues[0]).toContain("mine");
    expect(issues[0]).toContain("captured false");
    expect(issues[0]).toContain("resolved true");
  });

  test("catches a guild whose features silently vanished", () => {
    // The drifted-snapshot case: the capture said everything, the run got
    // nothing, and without this the bundle would be labelled as if it were
    // the beta guild.
    const issues = capabilityMismatches({
      config: config({ capabilities: EVERYTHING }),
      resolved: NOTHING,
    });
    // Seven, not eight: riotHistory is false on both sides, because a replay
    // never reproduces it.
    expect(issues).toHaveLength(7);
  });

  test("checks every capability", () => {
    expect(EXPLORE_REPLAY_CAPABILITIES).toHaveLength(8);
  });
});
