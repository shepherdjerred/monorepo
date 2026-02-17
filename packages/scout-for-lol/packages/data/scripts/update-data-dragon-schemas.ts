import { z } from "zod";

// Schemas for validation
export const SummonerSchema = z.object({
  type: z.string(),
  version: z.string(),
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tooltip: z.string(),
      maxrank: z.number(),
      cooldown: z.array(z.number()),
      cooldownBurn: z.string(),
      cost: z.array(z.number()),
      costBurn: z.string(),
      datavalues: z.object({}),
      effect: z.array(z.union([z.null(), z.array(z.number())])),
      effectBurn: z.array(z.union([z.null(), z.string()])),
      vars: z.array(z.unknown()),
      key: z.string(),
      summonerLevel: z.number(),
      modes: z.array(z.string()),
      costType: z.string(),
      maxammo: z.string(),
      range: z.array(z.number()),
      rangeBurn: z.string(),
      image: z.object({
        full: z.string(),
        sprite: z.string(),
        group: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
      resource: z.string(),
    }),
  ),
});

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

export const RuneTreeSchema = z.array(
  z.object({
    id: z.number(),
    key: z.string(),
    icon: z.string(),
    name: z.string(),
    slots: z.array(
      z.object({
        runes: z.array(
          z.object({
            id: z.number(),
            key: z.string(),
            icon: z.string(),
            name: z.string(),
            shortDesc: z.string(),
            longDesc: z.string(),
          }),
        ),
      }),
    ),
  }),
);

export type RuneTreeData = z.infer<typeof RuneTreeSchema>;

export const ChampionListSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

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
  dataValues: z.record(z.string(), z.number()).optional(),
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
  dataValues: Record<string, number>;
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
