import { z } from "zod";

/**
 * Zod schema for Riot League V4 responses
 * Based on Riot Games League V4 API
 *
 * This schema validates the structure of league/rank data received from Riot API.
 * Represents a summoner's ranked queue entry (Solo/Duo, Flex, Arena, etc.).
 */

/**
 * Known queue types for ranked leagues in Riot's League-V4 API
 */
export const RawRankedQueueTypeSchema = z.enum([
  // Summoner's Rift & Classic Queues
  "RANKED_SOLO_5x5",
  "RANKED_FLEX_SR",
  "RANKED_FLEX_TT", // Legacy Twisted Treeline
  "RANKED_PREMADE_5x5", // Clash / Premade 5s
  "RANKED_TEAM_5x5", // Legacy 5v5 ranked teams
  "RANKED_TEAM_3x3", // Legacy 3v3 ranked teams
  // Game Modes (Arena & Swiftplay)
  "CHERRY", // Arena rating
  "JADE_RANKED_SOLO_5x5", // Jade / Swiftplay Solo
  "JADE_RANKED_FLEX_5x5", // Jade / Swiftplay Flex
  // Teamfight Tactics
  "RANKED_TFT",
  "RANKED_TFT_DOUBLE_UP",
  "RANKED_TFT_TURBO",
  "RANKED_TFT_PAIRS",
  "RANKED_TFT_SET_1",
  "RANKED_TFT_SET_2",
  "RANKED_TFT_SET_3",
  "RANKED_TFT_SET_4",
  "RANKED_TFT_SET_5",
  "RANKED_TFT_SET_6",
  "RANKED_TFT_SET_7",
  "RANKED_TFT_SET_8",
  "RANKED_TFT_SET_9",
  "RANKED_TFT_SET_10",
  "RANKED_TFT_SET_11",
  "RANKED_TFT_SET_12",
  "RANKED_TFT_SET_13",
  "RANKED_TFT_SET_14",
  "RANKED_TFT_SET_15",
  "RANKED_TFT_SET_16",
  "RANKED_TFT_SET_17",
  "RANKED_TFT_SET_18",
  "RANKED_TFT_SET_19",
  "RANKED_TFT_SET_20",
]);
export type RawRankedQueueType = z.infer<typeof RawRankedQueueTypeSchema>;

/**
 * Tier names in ranked system (standard League tiers + game-mode specific tiers)
 */
export const RawTierNameSchema = z.enum([
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
  "WOOD",
  "SALT",
  "UNRANKED",
]);
export type RawTierName = z.infer<typeof RawTierNameSchema>;

/**
 * Division within a tier (I-V)
 */
export const RawDivisionSchema = z.enum(["I", "II", "III", "IV", "V"]);
export type RawDivision = z.infer<typeof RawDivisionSchema>;

/**
 * RawSummonerLeague - Represents a single ranked queue entry for a summoner from Riot API
 */
export const RawSummonerLeagueSchema = z
  .object({
    leagueId: z.string().optional(),
    queueType: RawRankedQueueTypeSchema,
    tier: RawTierNameSchema.optional(),
    rank: RawDivisionSchema.optional(),
    summonerId: z.string().optional(),
    puuid: z.string().optional(),
    leaguePoints: z.number().optional(),
    wins: z.number().optional(),
    losses: z.number().optional(),
    veteran: z.boolean().optional(),
    inactive: z.boolean().optional(),
    freshBlood: z.boolean().optional(),
    hotStreak: z.boolean().optional(),
    provisional: z.boolean().optional(),
    ratedTier: z.string().optional(),
    ratedRating: z.number().optional(),
    miniSeries: z
      .object({
        target: z.number().optional(),
        wins: z.number().optional(),
        losses: z.number().optional(),
        progress: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((entry, ctx) => {
    if (
      entry.queueType !== "RANKED_SOLO_5x5" &&
      entry.queueType !== "RANKED_FLEX_SR"
    ) {
      return;
    }

    if (entry.leaguePoints === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "standard ranked entries require leaguePoints",
        path: ["leaguePoints"],
      });
    }
    if (entry.wins === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "standard ranked entries require wins",
        path: ["wins"],
      });
    }
    if (entry.losses === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "standard ranked entries require losses",
        path: ["losses"],
      });
    }
  });

export type RawSummonerLeague = z.infer<typeof RawSummonerLeagueSchema>;
