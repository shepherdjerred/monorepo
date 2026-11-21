import { z } from "zod";

/**
 * The champion meta serving JSON: the roll-up's output and the one thing the
 * public meta API and the Explore meta tools read.
 *
 * ```
 * <build>/meta/v1/manifest.json
 * <build>/meta/v1/tiers/<patch>/<queueId>/<bracket>.json
 * <build>/meta/v1/champions/<championId>.json
 * <build>/meta/v1/matchups/<championId>.json     every opponent of one champion
 * ```
 *
 * It lives inside the lake build, so it is published by the same `CURRENT`
 * flip as the partials it was summed from: a build that erased a player never
 * serves JSON counted before the erasure. `v1` is the schema version of every
 * file below; a breaking change adds `v2/` beside it rather than rewriting
 * files a deployed reader still parses. The manifest names every file, so a
 * reader never lists a directory.
 *
 * Every statistic is a count pair plus a Wilson interval, and every slice
 * states its patch, queue, bracket and sample size.
 */

export const META_SERVING_VERSION = 1;
export const META_SERVING_DIR = "meta/v1";

export const META_BRACKETS = [
  "all",
  "low",
  "mid",
  "high",
  "master_plus",
] as const;
export const MetaBracketSchema = z.enum(META_BRACKETS);
export type MetaBracket = z.infer<typeof MetaBracketSchema>;

/** The rank tiers each bracket covers; `all` also holds unranked visits. */
export const META_BRACKET_TIERS: Record<
  Exclude<MetaBracket, "all">,
  readonly string[]
> = {
  low: ["iron", "bronze", "silver"],
  mid: ["gold", "platinum"],
  high: ["emerald", "diamond"],
  master_plus: ["master", "grandmaster", "challenger"],
};

export const MetaRoleSchema = z.enum([
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);
export type MetaRole = z.infer<typeof MetaRoleSchema>;

export const META_QUEUE_LABELS: Record<number, string> = {
  420: "ranked_solo",
  440: "ranked_flex",
  400: "normal_draft",
};

export const MetaTierGradeSchema = z.enum(["S", "A", "B", "C", "D"]);
export type MetaTierGrade = z.infer<typeof MetaTierGradeSchema>;

/**
 * A grade is decided on the lower bound of the 95% Wilson win-rate interval,
 * so a champion reaches S only when its interval clears 52%: a small sample
 * with a lucky point estimate stays low because its lower bound does.
 * Strata that fail the sample floor are not graded at all.
 */
export const META_TIER_LOWER_BOUNDS: readonly (readonly [
  MetaTierGrade,
  number,
])[] = [
  ["S", 0.52],
  ["A", 0.5],
  ["B", 0.48],
  ["C", 0.46],
  ["D", 0],
];

export type MetaThresholds = {
  /** Participants a (champion, role) slice needs to be served at all. */
  minSliceGames: number;
  /** Games a build, rune, spell, skill-order or item entry needs to be listed. */
  minEntryGames: number;
  /** Games a matchup needs to be listed. */
  minMatchupGames: number;
};

export const DEFAULT_META_THRESHOLDS: MetaThresholds = {
  minSliceGames: 100,
  minEntryGames: 20,
  minMatchupGames: 30,
};

export const RateSchema = z.object({
  value: z.number(),
  lower: z.number(),
  upper: z.number(),
});

/** Where a number came from; present on every slice and tier file. */
export const MetaContextSchema = z.object({
  patch: z.string(),
  queueId: z.number().int(),
  queue: z.string(),
  bracket: MetaBracketSchema,
});
export type MetaContext = z.infer<typeof MetaContextSchema>;

const CountedSchema = z.object({
  games: z.number().int(),
  wins: z.number().int(),
  winRate: RateSchema,
  /** Share of the entry's own denominator (see `denominator`). */
  share: RateSchema,
});

export const ChampionSliceSchema = z.object({
  context: MetaContextSchema.extend({ role: MetaRoleSchema }),
  sample: z.object({
    /** Participants who played the champion in this role. */
    games: z.number().int(),
    /** Matches in the patch, queue and bracket, the denominator of pick and ban rate. */
    matches: z.number().int(),
  }),
  winRate: RateSchema,
  pickRate: RateSchema,
  banRate: RateSchema,
  /** Share of the champion's games in this role. */
  roleShare: RateSchema,
  tier: MetaTierGradeSchema,
  coreItems: z.array(
    CountedSchema.extend({
      itemId: z.number().int(),
      denominator: z.literal("slice_games"),
    }),
  ),
  buildPaths: z.array(
    CountedSchema.extend({
      itemIds: z.array(z.number().int()),
      denominator: z.literal("games_with_timeline"),
    }),
  ),
  startingItems: z.array(
    CountedSchema.extend({
      items: z.array(
        z.object({ itemId: z.number().int(), count: z.number().int() }),
      ),
      denominator: z.literal("games_with_timeline"),
    }),
  ),
  runes: z.array(
    CountedSchema.extend({
      primaryStyleId: z.number().int(),
      primaryPerkIds: z.array(z.number().int()),
      secondaryStyleId: z.number().int(),
      secondaryPerkIds: z.array(z.number().int()),
      denominator: z.literal("games_with_runes"),
    }),
  ),
  spells: z.array(
    CountedSchema.extend({
      spellIds: z.array(z.number().int()),
      denominator: z.literal("slice_games"),
    }),
  ),
  skillOrders: z.array(
    CountedSchema.extend({
      /** Q, W and E in the order they were maxed. */
      order: z.string(),
      denominator: z.literal("games_with_timeline"),
    }),
  ),
  itemLift: z.array(
    z.object({
      trait: z.string(),
      baseline: z.object({
        games: z.number().int(),
        wins: z.number().int(),
        winRate: RateSchema,
      }),
      items: z.array(
        z.object({
          itemId: z.number().int(),
          games: z.number().int(),
          wins: z.number().int(),
          winRate: RateSchema,
          /** Item win rate in games against the trait minus the baseline. */
          lift: z.number(),
          /** The item's interval excludes the baseline win rate. */
          significant: z.boolean(),
        }),
      ),
    }),
  ),
});
export type ChampionSlice = z.infer<typeof ChampionSliceSchema>;

export const ChampionMetaFileSchema = z.object({
  schemaVersion: z.literal(META_SERVING_VERSION),
  buildId: z.string(),
  championId: z.number().int(),
  championName: z.string(),
  slices: z.array(ChampionSliceSchema),
});
export type ChampionMetaFile = z.infer<typeof ChampionMetaFileSchema>;

export const TierEntrySchema = z.object({
  championId: z.number().int(),
  championName: z.string(),
  role: MetaRoleSchema,
  tier: MetaTierGradeSchema,
  games: z.number().int(),
  wins: z.number().int(),
  winRate: RateSchema,
  pickRate: RateSchema,
  banRate: RateSchema,
});
export type TierEntry = z.infer<typeof TierEntrySchema>;

export const TierFileSchema = z.object({
  schemaVersion: z.literal(META_SERVING_VERSION),
  buildId: z.string(),
  context: MetaContextSchema,
  sample: z.object({ matches: z.number().int() }),
  /** Lower bound of the win-rate interval each grade needs. */
  gradeLowerBounds: z.record(z.string(), z.number()),
  entries: z.array(TierEntrySchema),
});
export type TierFile = z.infer<typeof TierFileSchema>;

export const MatchupSliceSchema = z.object({
  context: MetaContextSchema.extend({ role: MetaRoleSchema }),
  opponents: z.array(
    z.object({
      championId: z.number().int(),
      championName: z.string(),
      /** Games with the file's champion against this opponent in the same role. */
      games: z.number().int(),
      wins: z.number().int(),
      winRate: RateSchema,
    }),
  ),
});

export const MatchupFileSchema = z.object({
  schemaVersion: z.literal(META_SERVING_VERSION),
  buildId: z.string(),
  championId: z.number().int(),
  championName: z.string(),
  slices: z.array(MatchupSliceSchema),
});
export type MatchupFile = z.infer<typeof MatchupFileSchema>;

export const MetaManifestSchema = z.object({
  schemaVersion: z.literal(META_SERVING_VERSION),
  buildId: z.string(),
  generatedAt: z.iso.datetime(),
  /** Ingest days the numbers were summed over. */
  source: z.object({
    firstDay: z.string(),
    lastDay: z.string(),
    days: z.number().int(),
  }),
  thresholds: z.object({
    minSliceGames: z.number().int(),
    minEntryGames: z.number().int(),
    minMatchupGames: z.number().int(),
  }),
  /** The slice the API serves without query parameters; null when nothing meets the sample floor. */
  defaults: MetaContextSchema.omit({ queue: true }).nullable(),
  patches: z.array(z.string()),
  queues: z.array(z.object({ id: z.number().int(), label: z.string() })),
  brackets: z.array(MetaBracketSchema),
  champions: z.array(z.object({ id: z.number().int(), name: z.string() })),
  tiers: z.array(
    MetaContextSchema.extend({
      matches: z.number().int(),
      entries: z.number().int(),
      path: z.string(),
    }),
  ),
  caveats: z.array(z.string()),
});
export type MetaManifest = z.infer<typeof MetaManifestSchema>;

export const META_CAVEATS: readonly string[] = [
  "Counts come from the participant crawl: Summoner's Rift ranked solo, ranked flex and normal draft only. Arena, ARAM, Brawl, League Classic and any augment mode are excluded.",
  "The rank bracket is the rank of the player a match was found through, not of every participant.",
  "Build paths, starting items and skill orders come from the sampled subset of matches that have a timeline, so their sample is smaller than the slice's games.",
];

export function tierFilePath(context: MetaContext): string {
  return `tiers/${context.patch}/${context.queueId.toString()}/${context.bracket}.json`;
}

export function championFilePath(championId: number): string {
  return `champions/${championId.toString()}.json`;
}

export function matchupFilePath(championId: number): string {
  return `matchups/${championId.toString()}.json`;
}
