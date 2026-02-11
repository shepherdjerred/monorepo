import { z } from "zod";
import { LaneSchema } from "@shepherdjerred/scout-data/model/lane";

export const RuneSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
});

export type Rune = z.infer<typeof RuneSchema>;

export type Champion = z.infer<typeof ChampionSchema>;
export const ChampionSchema = z.object({
  riotIdGameName: z.string().min(0),
  championName: z.string().min(0),
  kills: z.number().nonnegative(),
  deaths: z.number().nonnegative(),
  assists: z.number().nonnegative(),
  // usually this can be a number between 1 and 18, but some modes have different levels, e.g. arena
  level: z.number().min(1),
  items: z.array(z.number()),
  lane: LaneSchema.optional(),
  spells: z.array(z.number()),
  gold: z.number().nonnegative(),
  runes: z.array(RuneSchema),
  creepScore: z.number().nonnegative(),
  visionScore: z.number().nonnegative(),
  damage: z.number().nonnegative(),
});
