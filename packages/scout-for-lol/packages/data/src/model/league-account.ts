import { z } from "zod";

export type RegionGroup = z.infer<typeof RegionGroupSchema>;
export const RegionGroupSchema = z.enum(["AMERICAS", "ASIA", "EUROPE", "SEA"]);

export type Region = z.infer<typeof RegionSchema>;
export const RegionSchema = z.enum([
  "BRAZIL",
  "EU_EAST",
  "EU_WEST",
  "KOREA",
  "LAT_NORTH",
  "LAT_SOUTH",
  "AMERICA_NORTH",
  "OCEANIA",
  "TURKEY",
  "RUSSIA",
  "JAPAN",
  "VIETNAM",
  "TAIWAN",
  "SINGAPORE",
  "PBE",
]);

const readableRegions: Record<Region, string> = {
  BRAZIL: "Brazil",
  EU_EAST: "Europe East",
  EU_WEST: "Europe West",
  KOREA: "Korea",
  LAT_NORTH: "Latin North",
  LAT_SOUTH: "Latin South",
  AMERICA_NORTH: "North America",
  OCEANIA: "Oceania",
  TURKEY: "Turkey",
  RUSSIA: "Russia",
  JAPAN: "Japan",
  VIETNAM: "Vietnam",
  TAIWAN: "Taiwan",
  SINGAPORE: "Singapore",
  PBE: "Public Beta Environment",
};

export function toReadableRegion(region: Region): string {
  return readableRegions[region];
}

export type LeagueSummonerId = z.infer<typeof LeagueSummonerIdSchema>;
export const LeagueSummonerIdSchema = z.string().min(0).max(63).brand<"LeagueSummonerId">();
export type LeaguePuuid = z.infer<typeof LeaguePuuidSchema>;
export const LeaguePuuidSchema = z.string().min(78).max(78).brand<"LeaguePuuid">();

// https://developer.riotgames.com/docs/summoner-name-to-riot-id-faq
// a riot ID looks like this: game_name#tag_line
export type RiotId = z.infer<typeof RiotIdSchema>;
export const RiotIdSchema = z
  .string()
  .regex(/^[\p{L}0-9 ]{3,16}#[\p{L}0-9]{3,5}$/u, "Riot ID must be in the format <game_name>#<tag_line>")
  .transform((val) => {
    const [gameName, tagLine] = val.split("#");
    return { game_name: gameName, tag_line: tagLine };
  })
  .pipe(
    z.object({
      game_name: z.string().min(3).max(16),
      tag_line: z.string().min(3).max(5),
    }),
  );

export type LeagueAccount = z.infer<typeof LeagueAccountSchema>;
export const LeagueAccountSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  region: RegionSchema,
});
