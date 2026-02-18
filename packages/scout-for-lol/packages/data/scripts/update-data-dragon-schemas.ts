import { z } from "zod";
import type { SummonerSchema } from "@scout-for-lol/data/data-dragon/summoner.ts";
import type { RuneTreeSchema } from "@scout-for-lol/data/data-dragon/runes.ts";

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
