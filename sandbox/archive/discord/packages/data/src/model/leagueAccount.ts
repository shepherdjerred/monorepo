import { z } from "https://esm.sh/zod@3.22.4";

export type LeagueAccount = z.infer<typeof LeagueAcccountSchema>;
export const LeagueAcccountSchema = z.strictObject({
  // AKA encrypted summoner ID
  id: z.string().min(0),
  accountId: z.string().min(0),
  puuid: z.string().min(0),
  region: z.enum([
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
    "THAILAND",
    "SINGAPORE",
    "PHILIPPINES",
    "PBE",
  ]),
});
