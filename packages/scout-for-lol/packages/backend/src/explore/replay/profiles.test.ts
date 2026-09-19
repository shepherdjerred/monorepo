import { describe, expect, test } from "vitest";
import {
  EXPLORE_REPLAY_CAPABILITIES,
  EXPLORE_REPLAY_PROFILES,
  capabilityMismatches,
  chipExpectation,
  conditionCapability,
  exploreReplayProfile,
  profileConsistencyIssues,
  type ExploreCapabilitySet,
  type ExploreReplayProfile,
} from "./profiles.ts";

const MINIMAL = exploreReplayProfile("minimal");
const FULL = exploreReplayProfile("full");

function capabilitySet(
  overrides: Partial<ExploreCapabilitySet> = {},
): ExploreCapabilitySet {
  return {
    bucks: overrides.bucks ?? false,
    dares: overrides.dares ?? false,
    challenges: overrides.challenges ?? false,
    creation: overrides.creation ?? false,
    riotHistory: overrides.riotHistory ?? false,
  };
}

describe("built-in profiles", () => {
  test("all are internally consistent", () => {
    for (const profile of EXPLORE_REPLAY_PROFILES) {
      expect(profileConsistencyIssues(profile)).toEqual([]);
    }
  });

  test("names are unique", () => {
    const names = EXPLORE_REPLAY_PROFILES.map((profile) => profile.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("minimal and full disagree on every gateable capability", () => {
    for (const capability of EXPLORE_REPLAY_CAPABILITIES) {
      if (capability === "riotHistory") continue; // off in both, deliberately
      expect(MINIMAL.expected[capability]).toBe(false);
      expect(FULL.expected[capability]).toBe(true);
    }
  });

  test("no profile enables on-demand Riot reads", () => {
    for (const profile of EXPLORE_REPLAY_PROFILES) {
      expect(profile.expected.riotHistory).toBe(false);
      const riot = profile.flagOverrides.find(
        (entry) => entry.flag === "explore_on_demand_riot_enabled",
      );
      expect(riot?.value).toBe(false);
    }
  });

  test("unknown profile names fail loudly and list the known ones", () => {
    expect(() => exploreReplayProfile("nope")).toThrow(
      /Unknown replay profile/,
    );
    expect(() => exploreReplayProfile("nope")).toThrow(/minimal/);
  });
});

describe("profileConsistencyIssues", () => {
  test("rejects dares without bucks", () => {
    const broken: ExploreReplayProfile = {
      ...MINIMAL,
      name: "broken",
      expected: capabilitySet({ dares: true }),
    };
    expect(profileConsistencyIssues(broken)).toEqual([
      expect.stringContaining("dares require a bucks capability"),
    ]);
  });

  test("rejects creation off the web surface", () => {
    const broken: ExploreReplayProfile = {
      ...MINIMAL,
      name: "broken",
      expected: capabilitySet({ creation: true }),
      surface: "discord",
    };
    expect(profileConsistencyIssues(broken)).toEqual([
      expect.stringContaining("creation tools are web-only"),
    ]);
  });
});

describe("conditionCapability", () => {
  test("maps feature conditions onto the capability that gates them", () => {
    expect(conditionCapability("bucks")).toBe("bucks");
    expect(conditionCapability("dares")).toBe("dares");
    expect(conditionCapability("challenges")).toBe("challenges");
    expect(conditionCapability("competitions")).toBe("creation");
    expect(conditionCapability("reports")).toBe("creation");
  });

  test("leaves lake-answerable conditions ungated", () => {
    // These are gated in the web UI by guild feature, but the questions
    // themselves are ordinary analytics — demanding a refusal would be wrong.
    expect(conditionCapability("always")).toBeNull();
    expect(conditionCapability("customs")).toBeNull();
    expect(conditionCapability("hall_of_fame")).toBeNull();
  });
});

describe("chipExpectation", () => {
  test("ungated conditions are answerable under every profile", () => {
    for (const profile of EXPLORE_REPLAY_PROFILES) {
      expect(chipExpectation(profile, "always")).toBe("answerable");
      expect(chipExpectation(profile, "customs")).toBe("answerable");
      expect(chipExpectation(profile, "hall_of_fame")).toBe("answerable");
    }
  });

  test("a gated condition flips with the profile", () => {
    expect(chipExpectation(MINIMAL, "bucks")).toBe("gated-off");
    expect(chipExpectation(FULL, "bucks")).toBe("answerable");
    expect(chipExpectation(MINIMAL, "competitions")).toBe("gated-off");
    expect(chipExpectation(FULL, "competitions")).toBe("answerable");
  });

  test("bucks-only answers bucks and dares but gates the rest", () => {
    const bucksOnly = exploreReplayProfile("bucks-only");
    expect(chipExpectation(bucksOnly, "bucks")).toBe("answerable");
    expect(chipExpectation(bucksOnly, "dares")).toBe("answerable");
    expect(chipExpectation(bucksOnly, "challenges")).toBe("gated-off");
    expect(chipExpectation(bucksOnly, "reports")).toBe("gated-off");
  });
});

describe("capabilityMismatches", () => {
  test("is empty when the turn resolved what the profile promised", () => {
    expect(
      capabilityMismatches({ profile: MINIMAL, resolved: capabilitySet() }),
    ).toEqual([]);
  });

  test("names the capability and the direction of the mismatch", () => {
    const issues = capabilityMismatches({
      profile: MINIMAL,
      resolved: capabilitySet({ bucks: true }),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("bucks");
    expect(issues[0]).toContain("expects false");
    expect(issues[0]).toContain("resolved true");
  });

  test("catches a full profile that silently ran as minimal", () => {
    const issues = capabilityMismatches({
      profile: FULL,
      resolved: capabilitySet(),
    });
    expect(issues).toHaveLength(4);
  });
});
