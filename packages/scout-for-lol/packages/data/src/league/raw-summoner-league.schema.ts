import { z } from "zod";

/**
 * Zod schema for RawSummonerLeague from the twisted library
 * Based on Riot Games League V4 API
 *
 * This schema validates the structure of league/rank data received from Riot API.
 * Represents a summoner's ranked queue entry (Solo/Duo or Flex).
 */

/**
 * Queue type for ranked leagues
 */
const QueueTypeSchema = z.enum([
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
  "RANKED_FLEX_TT", // Legacy Twisted Treeline
  "RANKED_TFT",
  "RANKED_TFT_DOUBLE_UP",
  "RANKED_TFT_TURBO",
  "RANKED_TFT_PAIRS",
]);

/**
 * Tier names in ranked system
 */
const TierNameSchema = z.enum([
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
]);

/**
 * Division within a tier (I-IV)
 */
const DivisionSchema = z.enum(["I", "II", "III", "IV"]);

/**
 * RawSummonerLeague - Represents a single ranked queue entry for a summoner from Riot API
 */
export const RawSummonerLeagueSchema = z
  .object({
    leagueId: z.string().optional(),
    queueType: QueueTypeSchema,
    tier: TierNameSchema,
    rank: DivisionSchema,
    summonerId: z.string().optional(),
    puuid: z.string().optional(), // Added: Riot API now returns puuid in league entries
    leaguePoints: z.number(),
    wins: z.number(),
    losses: z.number(),
    veteran: z.boolean().optional(),
    inactive: z.boolean().optional(),
    freshBlood: z.boolean().optional(),
    hotStreak: z.boolean().optional(),
    miniSeries: z
      .object({
        target: z.number(),
        wins: z.number(),
        losses: z.number(),
        progress: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Type inference from the Zod schema
export type RawSummonerLeague = z.infer<typeof RawSummonerLeagueSchema>;
