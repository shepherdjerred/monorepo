import { z } from "zod";
import type { SummonerSchema } from "#src/data-dragon/summoner.ts";
import type { RuneTreeSchema } from "#src/data-dragon/runes.ts";

export type SummonerData = z.infer<typeof SummonerSchema>;

export const ItemSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      name: z.string(),
      description: z.string(),
      plaintext: z.string().optional(),
      stats: z.record(z.string(), z.number()).optional(),
    }),
  ),
});

export type ItemData = z.infer<typeof ItemSchema>;

export type RuneTreeData = z.infer<typeof RuneTreeSchema>;

const ChampionIdSchema = z
  .string()
  .regex(/^\d+$/, "Champion key must be a numeric ID")
  .refine(
    (key) => {
      const championId = Number(key);
      return Number.isSafeInteger(championId) && championId > 0;
    },
    { message: "Champion key must be a positive safe integer" },
  );

export const ChampionListSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: ChampionIdSchema,
      name: z.string(),
      modernKey: ChampionIdSchema.optional(),
    }),
  ),
});

export type ChampionListData = z.infer<typeof ChampionListSchema>;

// Schema for CommunityDragon Arena augments API response
export const ArenaAugmentApiSchema = z.object({
  id: z.number(),
  apiName: z.string().optional(),
  name: z.string(),
  desc: z.string(),
  tooltip: z.string(),
  iconLarge: z.string(),
  iconSmall: z.string(),
  rarity: z.number(), // 1=prismatic, 2=gold, 3=silver
  dataValues: z
    .record(z.string(), z.union([z.number(), z.array(z.number())]))
    .optional(),
  calculations: z.record(z.string(), z.unknown()).optional(),
});

export const ArenaAugmentsApiResponseSchema = z.object({
  augments: z.array(ArenaAugmentApiSchema),
});

export type ArenaAugmentCacheEntry = {
  id: number;
  apiName?: string | undefined;
  name: string;
  desc: string;
  tooltip: string;
  iconLarge: string;
  iconSmall: string;
  rarity: "prismatic" | "gold" | "silver";
  dataValues: Record<string, number | number[]>;
  calculations: Record<string, unknown>;
  type: "full";
};

export function rarityNumberToString(
  rarity: number,
): "prismatic" | "gold" | "silver" {
  if (rarity === 1) {
    return "prismatic";
  }
  if (rarity === 2) {
    return "gold";
  }
  return "silver";
}

/**
 * Subset of CommunityDragon's per-champion JSON we consume for fallback
 * loading-screen art when Riot's Data Dragon CDN doesn't host a skin's JPG
 * (newer "tier" skins like Praetorian/Star Nemesis return 403 from Data
 * Dragon but are mirrored on CommunityDragon).
 *
 * Source: https://raw.communitydragon.org/{cdVersion}/plugins/rcp-be-lol-game-data/global/default/v1/champions/{championId}.json
 */
export const CDragonChampionSchema = z.object({
  id: z.number(),
  alias: z.string(),
  name: z.string(),
  relatedPrimeItemId: z.number().nullable(),
  squarePortraitPath: z.string().optional(),
  skins: z.array(
    z.object({
      id: z.number(),
      /** loadScreenPath is null for very old/unused entries; we skip those */
      loadScreenPath: z.string().nullable(),
    }),
  ),
});

export type CDragonChampion = z.infer<typeof CDragonChampionSchema>;

/**
 * CommunityDragon per-champion game bin (`.bin.json`) schemas, consumed by the
 * ability-facts generator.
 *
 * Source: https://raw.communitydragon.org/{cdVersion}/game/data/characters/{alias}/{alias}.bin.json
 *
 * These bins are converted from the game's binary property files, so shapes
 * vary per champion and fields equal to their engine default are OMITTED from
 * the JSON (e.g. a missing `mStat` means stat 0 = AP, a missing `mStatFormula`
 * means formula 0 = total). Everything here is `looseObject`: parse what we
 * understand, carry the rest, and let the resolver refuse (never guess) when a
 * referenced shape is not one of the known ones.
 */

/** A named per-rank value table. `values[0]` is rank 0 (unlearned); ranks are 1-indexed. */
export const CDragonSpellDataValueSchema = z.looseObject({
  name: z.string(),
  values: z.array(z.number()).optional(),
});
export type CDragonSpellDataValue = z.infer<typeof CDragonSpellDataValueSchema>;

/**
 * A tooltip calculation. `GameCalculation` carries `mFormulaParts`;
 * `GameCalculationModified` scales another calculation by `mMultiplier`.
 * Other `__type`s exist (e.g. `GameCalculationConditional`) — the resolver
 * treats them as unresolvable.
 */
export const CDragonGameCalculationSchema = z.looseObject({
  __type: z.string(),
  mFormulaParts: z.array(z.unknown()).optional(),
  mMultiplier: z.unknown().optional(),
  mModifiedGameCalculation: z.string().optional(),
  mDisplayAsPercent: z.boolean().optional(),
});
export type CDragonGameCalculation = z.infer<
  typeof CDragonGameCalculationSchema
>;

export const CDragonSpellRecordSchema = z.looseObject({
  DataValues: z.array(CDragonSpellDataValueSchema).optional(),
  mSpellCalculations: z
    .record(z.string(), CDragonGameCalculationSchema)
    .optional(),
});
export type CDragonSpellRecord = z.infer<typeof CDragonSpellRecordSchema>;

export const CDragonSpellObjectSchema = z.looseObject({
  __type: z.literal("SpellObject"),
  mSpell: CDragonSpellRecordSchema.optional(),
});
export type CDragonSpellObject = z.infer<typeof CDragonSpellObjectSchema>;

export const CDragonCharacterRecordSchema = z.looseObject({
  __type: z.literal("CharacterRecord"),
  /** Slot-ordered Q/W/E/R spell names, relative to `Characters/{alias}/Spells/`. */
  spellNames: z.array(z.string()).optional(),
  /** Full bin key of the passive's SpellObject. */
  mCharacterPassiveSpell: z.string().optional(),
});
export type CDragonCharacterRecord = z.infer<
  typeof CDragonCharacterRecordSchema
>;

/** The bin's top level: an object map keyed by bin entry path. */
export const CDragonChampionBinSchema = z.record(z.string(), z.unknown());
export type CDragonChampionBin = z.infer<typeof CDragonChampionBinSchema>;

// Calculation formula parts. Each schema is anchored on its `__type` literal;
// the resolver tries them in turn and refuses the whole calculation when a
// part matches none (that keeps "never guess" mechanical).

export const CDragonNamedDataValuePartSchema = z.looseObject({
  __type: z.literal("NamedDataValueCalculationPart"),
  mDataValue: z.string(),
});

export const CDragonStatByCoefficientPartSchema = z.looseObject({
  __type: z.literal("StatByCoefficientCalculationPart"),
  /** Omitted means stat 0 (AP). See STAT_NAMES in scripts/ability-facts.ts. */
  mStat: z.number().int().optional(),
  /** Omitted means formula 0 (total); 1 = base, 2 = bonus. */
  mStatFormula: z.number().int().optional(),
  mCoefficient: z.number(),
});

export const CDragonStatByNamedDataValuePartSchema = z.looseObject({
  __type: z.literal("StatByNamedDataValueCalculationPart"),
  mStat: z.number().int().optional(),
  mStatFormula: z.number().int().optional(),
  mDataValue: z.string(),
});

export const CDragonNumberPartSchema = z.looseObject({
  __type: z.literal("NumberCalculationPart"),
  /** Omitted means the engine default 0. */
  mNumber: z.number().optional(),
});

export const CDragonCharLevelInterpolationPartSchema = z.looseObject({
  __type: z.literal("ByCharLevelInterpolationCalculationPart"),
  mStartValue: z.number().optional(),
  mEndValue: z.number().optional(),
});

export const CDragonBreakpointSchema = z.looseObject({
  mLevel: z.number().int(),
  /** From this level onward every level-up adds this amount. */
  mBonusPerLevelAtAndAfter: z.number().optional(),
  /** One-time step increase at exactly this level. */
  mAdditionalBonusAtThisLevel: z.number().optional(),
});

export const CDragonCharLevelBreakpointsPartSchema = z.looseObject({
  __type: z.literal("ByCharLevelBreakpointsCalculationPart"),
  mLevel1Value: z.number().optional(),
  mBreakpoints: z.array(CDragonBreakpointSchema).optional(),
});

export const CDragonSumOfSubPartsPartSchema = z.looseObject({
  __type: z.literal("SumOfSubPartsCalculationPart"),
  mSubparts: z.array(z.unknown()),
});

/**
 * References the spell's effect-amount table — the same table Data Dragon
 * publishes as `effect`/`effectBurn` (`{{ eN }}`), so index N resolves from
 * the committed champion JSON's `effectBurn[N]`.
 */
export const CDragonEffectValuePartSchema = z.looseObject({
  __type: z.literal("EffectValueCalculationPart"),
  /** Omitted means the engine default 0 (which has no published effect). */
  mEffectIndex: z.number().int().optional(),
});

/**
 * `{f3cbe7b2}` is the (hash-named) part that inlines another calculation from
 * the same spell by key — self-documenting via its `mSpellCalculationKey`
 * field (e.g. Pyke's `RDamage` referenced from `ReducedDamageFinal`).
 */
export const CDragonCalculationReferencePartSchema = z.looseObject({
  __type: z.literal("{f3cbe7b2}"),
  mSpellCalculationKey: z.string(),
});
