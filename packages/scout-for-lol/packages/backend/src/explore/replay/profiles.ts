import { z } from "zod";
import type { SuggestionCondition } from "@scout-for-lol/data";
import type { FlagName } from "#src/configuration/flags.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";

/**
 * What a guild can actually do, captured rather than invented.
 *
 * An earlier version of this module declared synthetic configurations —
 * "everything off", "everything on" — and forced them. That answers "how does
 * Explore behave under a setup I made up", which is not the question. The
 * question is how it behaves for the guilds that exist: the beta guild, which
 * has every feature, and ordinary prod guilds, which have almost none.
 *
 * So a config is *recorded* from a stage's own flag service at pull time and
 * frozen into the dataset pin. Replay reproduces it, then checks it got what
 * was recorded. The capability set is the same shape either way, which is why
 * `chipExpectation` and `capabilityMismatches` did not have to change.
 */

/** The five capabilities the agent resolves per turn (`ExploreSkillOptions` minus surface). */
export const EXPLORE_REPLAY_CAPABILITIES = [
  "bucks",
  "dares",
  "challenges",
  "creation",
  "riotHistory",
] as const;

export type ExploreReplayCapability =
  (typeof EXPLORE_REPLAY_CAPABILITIES)[number];

export const ExploreCapabilitySetSchema = z
  .object({
    bucks: z.boolean(),
    dares: z.boolean(),
    challenges: z.boolean(),
    creation: z.boolean(),
    riotHistory: z.boolean(),
  })
  .strict();

export type ExploreCapabilitySet = z.infer<typeof ExploreCapabilitySetSchema>;

export const CapturedGuildConfigSchema = z
  .object({
    /**
     * Exactly one guild, never a list.
     *
     * `resolveBucksCapability` throws when more than one betting-enabled guild
     * is in scope (`bucks-tools.ts:79-84`), so one guild per config makes that
     * failure structurally impossible rather than a thing to remember.
     */
    guildId: z.string().min(1),
    /** How this guild is referred to in a bundle: "mine", "prod-top-1", … */
    label: z.string().min(1),
    /** Whose turn it is; the guild's own most-active Explore user. */
    requesterId: z.string().min(1),
    /** What the stage's flag service actually resolved, at `capturedAt`. */
    capabilities: ExploreCapabilitySetSchema,
    capturedAt: z.iso.datetime(),
  })
  .strict();

export type CapturedGuildConfig = z.infer<typeof CapturedGuildConfigSchema>;

export type ExploreReplayFlagOverride = {
  readonly flag: FlagName;
  readonly value: boolean;
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
 * What this chip is supposed to do for this guild.
 *
 * `answerable` — within reach, and a refusal is a regression.
 * `gated-off` — the feature is not live here, so the honest answer says so.
 */
export type ChipExpectation = "answerable" | "gated-off";

export function chipExpectation(
  capabilities: ExploreCapabilitySet,
  condition: SuggestionCondition,
): ChipExpectation {
  const capability = conditionCapability(condition);
  if (capability === null) return "answerable";
  return capabilities[capability] ? "answerable" : "gated-off";
}

/**
 * The flag overrides that reproduce a captured capability set.
 *
 * Derived from the set rather than stored beside it, so a pin cannot carry
 * flags that disagree with the capabilities they are supposed to produce.
 * Dares need all three of their flags because `dareExploreEnabled` requires
 * `(dare_v2 || dare_extended_contracts_enabled) && scoutql_relational_enabled`
 * on top of a bucks capability.
 */
export function flagOverridesFor(
  capabilities: ExploreCapabilitySet,
): readonly ExploreReplayFlagOverride[] {
  return [
    { flag: "betting_enabled", value: capabilities.bucks },
    { flag: "dare_v2", value: capabilities.dares },
    { flag: "dare_extended_contracts_enabled", value: capabilities.dares },
    { flag: "scoutql_relational_enabled", value: capabilities.dares },
    { flag: "challenge_runs_enabled", value: capabilities.challenges },
    { flag: "explore_creation_enabled", value: capabilities.creation },
    {
      flag: "explore_on_demand_riot_enabled",
      // Never reproduced, whatever was captured. The tool starts a Temporal
      // workflow and would write new matches into the snapshot mid-sweep,
      // making two runs of one corpus incomparable.
      value: false,
    },
  ];
}

/** Reasons a captured config could not be reproduced, whatever the flags say. */
export function guildConfigIssues(
  config: CapturedGuildConfig,
  surface: ExploreSurface,
): readonly string[] {
  const issues: string[] = [];
  if (config.capabilities.dares && !config.capabilities.bucks) {
    issues.push(
      "dares resolve from a bucks capability; a config cannot have dares with bucks off",
    );
  }
  if (surface !== "web" && config.capabilities.creation) {
    issues.push(
      `creation tools are web-only; surface "${surface}" cannot resolve them`,
    );
  }
  if (config.capabilities.riotHistory) {
    // Captured true is possible (it is on for the beta guild), but the replay
    // deliberately never reproduces it, so a config asserting it would fail
    // its own capability check on every case.
    issues.push(
      "on-demand Riot reads are never reproduced in a replay; capture them as false",
    );
  }
  return issues;
}

/**
 * Did this turn resolve what the capture recorded?
 *
 * Returns every mismatch rather than a boolean so a failing case can say which
 * capability was wrong and in which direction. This is what stops a run whose
 * guild install or flag state has drifted from being silently mislabelled.
 */
export function capabilityMismatches(input: {
  readonly config: CapturedGuildConfig;
  readonly resolved: ExploreCapabilitySet;
}): readonly string[] {
  return EXPLORE_REPLAY_CAPABILITIES.flatMap((capability) => {
    const expected = input.config.capabilities[capability];
    const actual = input.resolved[capability];
    return expected === actual
      ? []
      : [
          `${capability}: guild ${input.config.label} captured ${String(expected)}, turn resolved ${String(actual)}`,
        ];
  });
}
