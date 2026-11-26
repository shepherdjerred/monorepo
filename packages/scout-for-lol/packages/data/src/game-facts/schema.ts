import { z } from "zod";

/**
 * Per-entity game facts for the rich tooltips.
 *
 * Every tooltip shares one anatomy: a header (icon, name, kind, one key
 * fact), two or three labelled facts, the game's own description trimmed to a
 * sentence or two, parts that have tooltips of their own, then a block the
 * page fills with Scout's numbers and a link. These schemas carry the game's
 * half of that anatomy; the Scout block and the link never appear here.
 *
 * One JSON file is emitted per entity at
 * `/assets/scout/game/<patch>/facts/<kind>/<key>.json`, generated from the
 * committed Data Dragon snapshot by `scripts/generate-game-facts.ts`.
 *
 * Keys:
 * - champion: the Data Dragon key (`Ahri`, `MonkeyKing`).
 * - ability: `<champion key>-<slot>`, the same identity as the ability icon
 *   (`Ahri-E`, `Ahri-passive`).
 * - item, rune, summoner spell: the numeric Riot id, as match data carries it
 *   (`3118`, `8112`, `14`).
 * - keyword: a lowercase slug from the tips glossary (`charm`).
 */

export const GAME_FACT_KINDS = [
  "champion",
  "ability",
  "item",
  "rune",
  "summoner-spell",
  "keyword",
] as const;
export const GameFactKindSchema = z.enum(GAME_FACT_KINDS);
export type GameFactKind = z.infer<typeof GameFactKindSchema>;

/** A labelled value, already formatted for display ("Cost", "2700 gold"). */
export const GameFactEntrySchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});
export type GameFactEntry = z.infer<typeof GameFactEntrySchema>;

/**
 * Image path relative to the game asset root
 * (`/assets/scout/game/<patch>/`), for example `img/champion/Ahri.png`.
 */
const GameImagePathSchema = z.string().regex(/^img\/[\w-]+\/[\w.-]+$/);

/** A part that has a tooltip of its own: an ability, a component item. */
export const GameFactPartSchema = z.object({
  kind: GameFactKindSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  icon: GameImagePathSchema.nullable(),
});
export type GameFactPart = z.infer<typeof GameFactPartSchema>;

const baseShape = {
  /** Data Dragon patch the facts were generated from, for example `16.23.1`. */
  patch: z.string().min(1),
  key: z.string().min(1),
  name: z.string().min(1),
  /** The game's own description, markup stripped, one or two sentences. */
  description: z.string(),
  /** Two or three labelled facts. */
  facts: z.array(GameFactEntrySchema),
  parts: z.array(GameFactPartSchema),
};

export const ChampionFactSchema = z.object({
  kind: z.literal("champion"),
  ...baseShape,
  icon: GameImagePathSchema,
  /** Splash image for the header strip. */
  art: GameImagePathSchema,
  title: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  keyFact: GameFactEntrySchema,
});
export type ChampionFact = z.infer<typeof ChampionFactSchema>;

export const AbilitySlotSchema = z.enum(["passive", "Q", "W", "E", "R"]);

/** Values by rank; index 0 is rank 1. Empty for passives. */
const ByRankSchema = z.array(z.number());

export const AbilityFactSchema = z.object({
  kind: z.literal("ability"),
  ...baseShape,
  icon: GameImagePathSchema,
  slot: AbilitySlotSchema,
  championKey: z.string().min(1),
  championName: z.string().min(1),
  maxRank: z.number().int().min(1),
  cooldownByRank: ByRankSchema,
  costByRank: ByRankSchema,
  /** Resource the cost is paid in ("Mana", "Energy"); empty for no cost. */
  costType: z.string(),
  rangeByRank: ByRankSchema,
  keyFact: GameFactEntrySchema,
});
export type AbilityFact = z.infer<typeof AbilityFactSchema>;

export const ItemFactSchema = z.object({
  kind: z.literal("item"),
  ...baseShape,
  icon: GameImagePathSchema,
  /** Total gold cost, and the gold still owed on top of the recipe parts. */
  goldTotal: z.number().int().nonnegative(),
  goldCombine: z.number().int().nonnegative(),
  keyFact: GameFactEntrySchema,
});
export type ItemFact = z.infer<typeof ItemFactSchema>;

export const RuneFactSchema = z.object({
  kind: z.literal("rune"),
  ...baseShape,
  icon: GameImagePathSchema,
  tree: z.string().min(1),
  keyFact: GameFactEntrySchema,
});
export type RuneFact = z.infer<typeof RuneFactSchema>;

export const SummonerSpellFactSchema = z.object({
  kind: z.literal("summoner-spell"),
  ...baseShape,
  icon: GameImagePathSchema,
  cooldownSeconds: z.number().nonnegative(),
  keyFact: GameFactEntrySchema,
});
export type SummonerSpellFact = z.infer<typeof SummonerSpellFactSchema>;

/**
 * Keywords come from the tips glossary (a status such as "charmed"). The
 * schema is fixed now; no entries are emitted until the glossary lands.
 */
export const KeywordFactSchema = z.object({
  kind: z.literal("keyword"),
  ...baseShape,
  icon: GameImagePathSchema.nullable(),
  keyFact: GameFactEntrySchema.nullable(),
});
export type KeywordFact = z.infer<typeof KeywordFactSchema>;

export const GameFactSchema = z.discriminatedUnion("kind", [
  ChampionFactSchema,
  AbilityFactSchema,
  ItemFactSchema,
  RuneFactSchema,
  SummonerSpellFactSchema,
  KeywordFactSchema,
]);
export type GameFact = z.infer<typeof GameFactSchema>;

/** Path of a fact file below the game asset root. */
export function gameFactPath(kind: GameFactKind, key: string): string {
  return `facts/${kind}/${key}.json`;
}
