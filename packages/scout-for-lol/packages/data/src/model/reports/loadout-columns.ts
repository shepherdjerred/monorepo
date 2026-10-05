import { z } from "zod";

const PositiveGameAssetIdSchema = z.number().int().positive();

export const MatchRunePageSchema = z.object({
  primaryStyleId: PositiveGameAssetIdSchema,
  primaryRuneIds: z.tuple([
    PositiveGameAssetIdSchema,
    PositiveGameAssetIdSchema,
    PositiveGameAssetIdSchema,
    PositiveGameAssetIdSchema,
  ]),
  secondaryStyleId: PositiveGameAssetIdSchema,
  secondaryRuneIds: z.tuple([
    PositiveGameAssetIdSchema,
    PositiveGameAssetIdSchema,
  ]),
  // Null for a match the Scout Client built, which reports no stat shards.
  statShardIds: z
    .object({
      offense: PositiveGameAssetIdSchema,
      flex: PositiveGameAssetIdSchema,
      defense: PositiveGameAssetIdSchema,
    })
    .nullable(),
});

export type MatchRunePage = z.infer<typeof MatchRunePageSchema>;

export const MatchLoadoutSchema = z.object({
  itemIds: z.array(z.number().int().nonnegative()).length(7),
  summonerSpellIds: z.tuple([
    PositiveGameAssetIdSchema,
    PositiveGameAssetIdSchema,
  ]),
  runes: MatchRunePageSchema.nullable(),
});

export type MatchLoadout = z.infer<typeof MatchLoadoutSchema>;

/** Optional ScoutQL ids are read only when the query names a loadout column. */
const LoadoutIdSchema = z.number().nullable().default(null);

export const ScoutQlLoadoutLakeSchema = z.object({
  summoner1_id: LoadoutIdSchema,
  summoner2_id: LoadoutIdSchema,
  perk_primary_style: LoadoutIdSchema,
  perk_sub_style: LoadoutIdSchema,
  perk0: LoadoutIdSchema,
  perk1: LoadoutIdSchema,
  perk2: LoadoutIdSchema,
  perk3: LoadoutIdSchema,
  perk4: LoadoutIdSchema,
  perk5: LoadoutIdSchema,
  stat_perk_offense: LoadoutIdSchema,
  stat_perk_flex: LoadoutIdSchema,
  stat_perk_defense: LoadoutIdSchema,
});

export const RUNE_SPELL_COLUMNS = [
  "summoner1_id",
  "summoner2_id",
  "perk_primary_style",
  "perk_sub_style",
  "perk0",
  "perk1",
  "perk2",
  "perk3",
  "perk4",
  "perk5",
  "stat_perk_offense",
  "stat_perk_flex",
  "stat_perk_defense",
] as const;

export const SCOUTQL_LOADOUT_LAKE_COLUMNS = {
  summoner1_id: "INTEGER",
  summoner2_id: "INTEGER",
  perk_primary_style: "INTEGER",
  perk_sub_style: "INTEGER",
  perk0: "INTEGER",
  perk1: "INTEGER",
  perk2: "INTEGER",
  perk3: "INTEGER",
  perk4: "INTEGER",
  perk5: "INTEGER",
  stat_perk_offense: "INTEGER",
  stat_perk_flex: "INTEGER",
  stat_perk_defense: "INTEGER",
} as const;
