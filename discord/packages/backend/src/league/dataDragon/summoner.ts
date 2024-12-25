import { z } from "https://esm.sh/zod@3.22.4";
import { latestVersion } from "./version.ts";

// schema created by https://transform.tools/json-to-zod
export type Summoner = z.infer<typeof SummonerSchema>;
const SummonerSchema = z.object({
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

export const summoner = SummonerSchema.parse(
  await (
    await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/summoner.json`,
    )
  ).json(),
);
