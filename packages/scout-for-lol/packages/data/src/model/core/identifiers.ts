import { z } from "zod";

/**
 * Branded identifier for a League of Legends champion (e.g. 1 for Annie, 64 for Lee Sin, 805 for Locke).
 */
export type ChampionId = z.infer<typeof ChampionIdSchema>;
export const ChampionIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"ChampionId">();
export const SummonerSpellIdSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"SummonerSpellId">();
export const RuneIdSchema = z.number().int().positive().brand<"RuneId">();
/**
 * Unix timestamp in seconds (used by Riot MatchV5 query filters startTime / endTime).
 */
export type EpochSeconds = z.infer<typeof EpochSecondsSchema>;
export const EpochSecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"EpochSeconds">();
/**
 * Branded string for the gameName portion of a Riot ID (1-16 chars).
 */
export type RiotGameName = z.infer<typeof RiotGameNameSchema>;
export const RiotGameNameSchema = z
  .string()
  .min(1)
  .max(16)
  .brand<"RiotGameName">();

/**
 * Branded string for the tagLine portion of a Riot ID (1-5 chars).
 */
export type RiotTagLine = z.infer<typeof RiotTagLineSchema>;
export const RiotTagLineSchema = z
  .string()
  .min(1)
  .max(5)
  .brand<"RiotTagLine">();
