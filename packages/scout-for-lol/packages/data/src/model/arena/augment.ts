import { z } from "zod";

export const AugmentRaritySchema = z.union([z.literal("prismatic"), z.literal("gold"), z.literal("silver")]);
export type AugmentRarity = z.infer<typeof AugmentRaritySchema>;

// Full augments are retrieved from the CommunityDragon API. The Riot API only provides the ID
export const FullAugmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  rarity: AugmentRaritySchema,
  apiName: z.string(),
  desc: z.string(),
  tooltip: z.string(),
  iconLarge: z.string(),
  iconSmall: z.string(),
  calculations: z.unknown(),
  dataValues: z.record(z.string(), z.unknown()),
  type: z.literal("full"),
});
export type FullAugment = z.infer<typeof FullAugmentSchema>;

export const MinimalAugmentSchema = z.strictObject({
  id: z.number(),
  type: z.literal("id"),
});
export type MinimalAugment = z.infer<typeof MinimalAugmentSchema>;

export const AugmentSchema = z.discriminatedUnion("type", [FullAugmentSchema, MinimalAugmentSchema]);
export type Augment = z.infer<typeof AugmentSchema>;
