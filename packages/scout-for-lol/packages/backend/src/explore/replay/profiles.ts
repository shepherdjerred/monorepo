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
 * So a config is *recorded* at pull time and frozen into the dataset pin —
 * from the stage's own flag provider when one is reachable, otherwise from its
 * static configuration, with the pin saying which it was. Replay reproduces it, then checks it got what
 * was recorded. The capability set is the same shape either way, which is why
 * `chipExpectation` and `capabilityMismatches` did not have to change.
 */

/** The capabilities the agent resolves per turn (`ExploreSkillOptions` minus surface). */
export const EXPLORE_REPLAY_CAPABILITIES = [
  "bucks",
  "dares",
  "challenges",
  "creation",
  "riotHistory",
  "mvpVotes",
  "clash",
  "hallOfFame",
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
    mvpVotes: z.boolean(),
    clash: z.boolean(),
    hallOfFame: z.boolean(),
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
 * `customs` maps to nothing: its chips are ordinary lake analytics that
 * ScoutQL answers with no extra tool.
 *
 * `hall_of_fame` maps to nothing. Where the Hall is on, Explore reads the
 * board with its tool; where it is off, a record question still has an
 * answer — the best single game in match data under the Hall's own rules —
 * and the honest reply gives it, saying it is not the official board. Grading
 * those chips as "must decline" marked seven helpful prod answers as wrong.
 *
 * Competitions are split. Reading them is a core feature with no flag, done by
 * permission-checked tools every turn has, so `competitions` maps to nothing.
 * Creating one needs the creation tool, so `competition_creation` maps to
 * `creation`. Both used to map to `creation`, which graded "show the current
 * standings" against a flag unrelated to reading them.
 *
 * `reports` is deliberately NOT mapped. Its chips are a mix: "subscribe me to
 * a weekly report" needs the creation tool, while "generate a role
 * distribution report" is answered by querying and presenting. In the beta run
 * nine declined and six answered informatively, and both were right. Asserting
 * either way would be wrong for half of them, so the condition resolves to
 * `either` and a person reads those cases.
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
  competitions: null,
  competition_creation: "creation",
  mvp_votes: "mvpVotes",
  reports: null,
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
 * `either` — both are defensible, so the eval asserts nothing and a person
 *   reads the case. Better than an assertion that is wrong half the time:
 *   a signal nobody trusts is worse than no signal.
 */
export type ChipExpectation = "answerable" | "gated-off" | "either";

/** Conditions whose chips legitimately go both ways; see `CONDITION_CAPABILITY`. */
const UNASSERTABLE_CONDITIONS: ReadonlySet<SuggestionCondition> =
  new Set<SuggestionCondition>(["reports"]);

export function chipExpectation(
  capabilities: ExploreCapabilitySet,
  condition: SuggestionCondition,
): ChipExpectation {
  if (UNASSERTABLE_CONDITIONS.has(condition)) return "either";
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
    { flag: "mvp_votes_enabled", value: capabilities.mvpVotes },
    { flag: "clash_surface", value: capabilities.clash },
    { flag: "hall_of_fame_enabled", value: capabilities.hallOfFame },
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
