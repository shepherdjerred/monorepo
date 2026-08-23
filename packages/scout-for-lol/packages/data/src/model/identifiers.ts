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

/**
 * Branded identifier for an in-game item (e.g. 3031 for Infinity Edge, 0 for empty slot).
 */
export type ItemId = z.infer<typeof ItemIdSchema>;
export const ItemIdSchema = z.number().int().nonnegative().brand<"ItemId">();

/**
 * Branded identifier for a matchmaking queue (e.g. 420 for Ranked Solo, 440 for Ranked Flex, 450 for ARAM).
 */
export type QueueId = z.infer<typeof QueueIdSchema>;
export const QueueIdSchema = z.number().int().brand<"QueueId">();

/**
 * Branded identifier for a game map (e.g. 11 for Summoner's Rift, 12 for Howling Abyss, 30 for Arena).
 */
export type MapId = z.infer<typeof MapIdSchema>;
export const MapIdSchema = z.number().int().brand<"MapId">();

/**
 * Branded identifier for a summoner spell (e.g. 4 for Flash, 14 for Ignite, 11 for Smite).
 */
export type SummonerSpellId = z.infer<typeof SummonerSpellIdSchema>;
export const SummonerSpellIdSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"SummonerSpellId">();

/**
 * Branded identifier for an individual rune perk (e.g. 8005 for Press the Attack, 8112 for Electrocute).
 */
export type RuneId = z.infer<typeof RuneIdSchema>;
export const RuneIdSchema = z.number().int().positive().brand<"RuneId">();

/**
 * Branded identifier for a primary/secondary rune style tree (e.g. 8000 for Precision, 8100 for Domination).
 */
export type RuneTreeId = z.infer<typeof RuneTreeIdSchema>;
export const RuneTreeIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"RuneTreeId">();

/**
 * Branded identifier for an Arena mode augment.
 */
export type ArenaAugmentId = z.infer<typeof ArenaAugmentIdSchema>;
export const ArenaAugmentIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"ArenaAugmentId">();

/**
 * Branded identifier for champion skin number (0 for default base skin).
 */
export type SkinNum = z.infer<typeof SkinNumSchema>;
export const SkinNumSchema = z.number().int().nonnegative().brand<"SkinNum">();

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
 * Unix timestamp in milliseconds (Date.getTime(), match creation / spectator timestamps).
 */
export type EpochMilliseconds = z.infer<typeof EpochMillisecondsSchema>;
export const EpochMillisecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"EpochMilliseconds">();

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

/**
 * Branded string for Riot API keys / tokens.
 */
export type RiotApiToken = z.infer<typeof RiotApiTokenSchema>;
export const RiotApiTokenSchema = z.string().min(1).brand<"RiotApiToken">();

/**
 * Branded string for Riot Edge Trace IDs (X-Riot-Edge-Trace-Id header).
 */
export type RiotEdgeTraceId = z.infer<typeof RiotEdgeTraceIdSchema>;
export const RiotEdgeTraceIdSchema = z.string().brand<"RiotEdgeTraceId">();
