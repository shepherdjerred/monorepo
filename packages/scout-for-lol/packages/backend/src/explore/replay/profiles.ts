import type { SuggestionCondition } from "@scout-for-lol/data";
import type { FlagName } from "#src/configuration/flags.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";

/**
 * Which Explore features a replay run has switched on.
 *
 * Running a corpus under one configuration only ever shows half the product.
 * A dares question is supposed to reach the dare tool where Bryan Bucks is
 * live, and is supposed to say Scout does not do that here where it is not —
 * both are correct answers, and which one is correct depends entirely on this.
 * So the configuration is an explicit axis of the eval rather than whatever
 * the developer's guild happened to have enabled.
 */

/**
 * The five capabilities the agent actually resolves per turn.
 *
 * This list is `ExploreSkillOptions` minus `surface`, and it is deliberately
 * shorter than the chip catalog's list of gating conditions — see
 * `CONDITION_CAPABILITY` for why those are not the same thing.
 */
export const EXPLORE_REPLAY_CAPABILITIES = [
  "bucks",
  "dares",
  "challenges",
  "creation",
  "riotHistory",
] as const;

export type ExploreReplayCapability =
  (typeof EXPLORE_REPLAY_CAPABILITIES)[number];

export type ExploreCapabilitySet = Readonly<
  Record<ExploreReplayCapability, boolean>
>;

export type ExploreReplayFlagOverride = {
  readonly flag: FlagName;
  readonly value: boolean;
};

export type ExploreReplayProfile = {
  readonly name: string;
  readonly description: string;
  /**
   * What the agent must resolve for this profile to mean what it says.
   *
   * Checked against the capabilities the turn actually resolved, never
   * assumed. A persona seeded without Bryan Bucks would otherwise produce a
   * `full` run that is really `minimal`, and every conclusion drawn from it
   * would be wrong while looking fine.
   */
  readonly expected: ExploreCapabilitySet;
  /** Applied to the flag registry before the turn, scoped to the persona's guilds. */
  readonly flagOverrides: readonly ExploreReplayFlagOverride[];
  readonly surface: ExploreSurface;
};

/**
 * Which capability gates a chip's condition — where one does at all.
 *
 * `customs` and `hall_of_fame` map to nothing. Those chips are gated in the
 * web app because the *guild* has the feature, but the questions themselves
 * are ordinary lake analytics that ScoutQL answers with no extra tool. Mapping
 * them onto a capability would make the eval demand a refusal that Explore is
 * right not to give.
 *
 * `competitions` and `reports` both map to `creation`: making either one goes
 * through the same creation tools.
 */
const CONDITION_CAPABILITY: Readonly<
  Record<SuggestionCondition, ExploreReplayCapability | null>
> = {
  always: null,
  customs: null,
  hall_of_fame: null,
  bucks: "bucks",
  dares: "dares",
  challenges: "challenges",
  competitions: "creation",
  reports: "creation",
};

export function conditionCapability(
  condition: SuggestionCondition,
): ExploreReplayCapability | null {
  return CONDITION_CAPABILITY[condition];
}

/**
 * What this chip is supposed to do under this profile.
 *
 * `answerable` — the question is within reach and a refusal is a regression.
 * `gated-off` — the feature is not live, so the honest answer says so; an
 * answer that proceeds as if the feature existed is the regression.
 */
export type ChipExpectation = "answerable" | "gated-off";

export function chipExpectation(
  profile: ExploreReplayProfile,
  condition: SuggestionCondition,
): ChipExpectation {
  const capability = conditionCapability(condition);
  if (capability === null) return "answerable";
  return profile.expected[capability] ? "answerable" : "gated-off";
}

/**
 * Reasons a profile could never be satisfied, whatever the persona.
 *
 * Dares resolve from a non-null bucks capability, so dares-on with bucks-off
 * is not a configuration — it is a typo that would spend a whole sweep before
 * failing its capability assertions one case at a time.
 */
export function profileConsistencyIssues(
  profile: ExploreReplayProfile,
): readonly string[] {
  const issues: string[] = [];
  if (profile.expected.dares && !profile.expected.bucks) {
    issues.push(
      "dares require a bucks capability; a profile cannot enable dares with bucks off",
    );
  }
  if (profile.expected.creation && profile.surface !== "web") {
    issues.push(
      `creation tools are web-only; surface "${profile.surface}" cannot resolve them`,
    );
  }
  return issues;
}

function capabilities(
  overrides: Partial<ExploreCapabilitySet>,
): ExploreCapabilitySet {
  return {
    bucks: overrides.bucks ?? false,
    dares: overrides.dares ?? false,
    challenges: overrides.challenges ?? false,
    creation: overrides.creation ?? false,
    riotHistory: overrides.riotHistory ?? false,
  };
}

/**
 * On-demand Riot reads stay off in every built-in profile.
 *
 * The tool starts a Temporal workflow rather than fetching inline, so a
 * harness that ran it would need a worker and would write new matches into the
 * snapshot mid-sweep, making two runs of one corpus incomparable. It is also
 * faithful: the flag defaults to false and is overridden only for one beta
 * server, so essentially every real turn ran without it.
 */
const RIOT_OFF: ExploreReplayFlagOverride = {
  flag: "explore_on_demand_riot_enabled",
  value: false,
};

export const EXPLORE_REPLAY_PROFILES: readonly ExploreReplayProfile[] = [
  {
    name: "minimal",
    description:
      "Every gated feature off. Only lake analytics are reachable, so every conditioned chip must say so rather than improvise.",
    expected: capabilities({}),
    flagOverrides: [
      RIOT_OFF,
      { flag: "betting_enabled", value: false },
      { flag: "dare_v2", value: false },
      { flag: "challenge_runs_enabled", value: false },
      { flag: "explore_creation_enabled", value: false },
    ],
    surface: "web",
  },
  {
    name: "full",
    description:
      "Every feature a web turn can have. A conditioned chip that refuses here is a regression.",
    expected: capabilities({
      bucks: true,
      dares: true,
      challenges: true,
      creation: true,
    }),
    flagOverrides: [
      RIOT_OFF,
      { flag: "betting_enabled", value: true },
      { flag: "dare_v2", value: true },
      { flag: "dare_extended_contracts_enabled", value: true },
      { flag: "scoutql_relational_enabled", value: true },
      { flag: "challenge_runs_enabled", value: true },
      { flag: "explore_creation_enabled", value: true },
    ],
    surface: "web",
  },
  {
    name: "bucks-only",
    description:
      "Bryan Bucks and dares, nothing else. Catches a challenges or creation question answered through the bucks tools.",
    expected: capabilities({ bucks: true, dares: true }),
    flagOverrides: [
      RIOT_OFF,
      { flag: "betting_enabled", value: true },
      { flag: "dare_v2", value: true },
      { flag: "dare_extended_contracts_enabled", value: true },
      { flag: "scoutql_relational_enabled", value: true },
      { flag: "challenge_runs_enabled", value: false },
      { flag: "explore_creation_enabled", value: false },
    ],
    surface: "web",
  },
  {
    name: "creation-only",
    description:
      "Reports, subscriptions and competitions, nothing else. Catches creation leaking into a bucks or challenges answer.",
    expected: capabilities({ creation: true }),
    flagOverrides: [
      RIOT_OFF,
      { flag: "betting_enabled", value: false },
      { flag: "dare_v2", value: false },
      { flag: "challenge_runs_enabled", value: false },
      { flag: "explore_creation_enabled", value: true },
    ],
    surface: "web",
  },
];

export function exploreReplayProfile(name: string): ExploreReplayProfile {
  const profile = EXPLORE_REPLAY_PROFILES.find((entry) => entry.name === name);
  if (profile === undefined) {
    const known = EXPLORE_REPLAY_PROFILES.map((entry) => entry.name).join(", ");
    throw new Error(
      `Unknown replay profile "${name}". Known profiles: ${known}`,
    );
  }
  return profile;
}

/**
 * Did this turn resolve the capabilities its profile promised?
 *
 * Returns every mismatch rather than a boolean so a failing case can say which
 * capability was wrong and in which direction.
 */
export function capabilityMismatches(input: {
  readonly profile: ExploreReplayProfile;
  readonly resolved: ExploreCapabilitySet;
}): readonly string[] {
  return EXPLORE_REPLAY_CAPABILITIES.flatMap((capability) => {
    const expected = input.profile.expected[capability];
    const actual = input.resolved[capability];
    return expected === actual
      ? []
      : [
          `${capability}: profile "${input.profile.name}" expects ${String(expected)}, turn resolved ${String(actual)}`,
        ];
  });
}
