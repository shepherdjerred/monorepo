import { z } from "zod";
import { RanksSchema } from "#src/model/rank.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import { TeamSchema } from "#src/model/team.ts";

/**
 * Layout mode determines how participants are arranged visually.
 * - "standard": 5v5 with two columns (ranked, draft, quickplay, swiftplay, brawl, URF, custom, clash)
 * - "aram": 5v5 with two columns, no bans (ARAM / ARAM clash)
 * - "arena": 8 teams of 2 in a grid layout
 */
export type LoadingScreenLayout = z.infer<typeof LoadingScreenLayoutSchema>;
export const LoadingScreenLayoutSchema = z.enum(["standard", "aram", "arena"]);

/**
 * Branded type for summoner spell IDs (e.g., 4=Flash, 14=Ignite).
 */
export type SummonerSpellId = z.infer<typeof SummonerSpellIdSchema>;
export const SummonerSpellIdSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"SummonerSpellId">();

/**
 * Branded type for rune IDs (keystone, tree, etc.).
 */
export type RuneId = z.infer<typeof RuneIdSchema>;
export const RuneIdSchema = z.number().int().positive().brand<"RuneId">();

/**
 * Branded type for Riot champion IDs (e.g., 1=Annie, 266=Aatrox).
 */
export type LoadingScreenChampionId = z.infer<
  typeof LoadingScreenChampionIdSchema
>;
export const LoadingScreenChampionIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"LoadingScreenChampionId">();

/**
 * A single participant on the loading screen.
 * Contains all info needed to render one player card.
 */
export type LoadingScreenParticipant = z.infer<
  typeof LoadingScreenParticipantSchema
>;
export const LoadingScreenParticipantSchema = z.strictObject({
  /** Riot PUUID */
  puuid: z.string(),
  /** In-game summoner name */
  summonerName: z.string(),
  /** Champion key for image lookup (e.g., "Aatrox", "LeeSin") */
  championName: z.string(),
  /** Human-readable champion name (e.g., "Lee Sin") */
  championDisplayName: z.string(),
  /** Skin number for loading screen art (0 = default) */
  skinNum: z.number().int().nonnegative(),
  /** Team side: "blue" or "red" for standard/ARAM, or arena team number */
  team: z.union([TeamSchema, z.number().int().positive()]),
  /** Summoner spell 1 ID (e.g., 4=Flash) */
  spell1Id: SummonerSpellIdSchema,
  /** Summoner spell 2 ID (e.g., 14=Ignite) */
  spell2Id: SummonerSpellIdSchema,
  /** Keystone rune ID (first perk in primary tree) */
  keystoneRuneId: RuneIdSchema.optional(),
  /** Secondary rune tree ID */
  secondaryTreeId: RuneIdSchema.optional(),
  /** Ranks (solo + flex, fetched via LeagueV4) */
  ranks: RanksSchema.optional(),
  /** Whether this player is tracked by the bot */
  isTrackedPlayer: z.boolean(),
});

/**
 * A banned champion shown in the loading screen header.
 */
export type LoadingScreenBan = z.infer<typeof LoadingScreenBanSchema>;
export const LoadingScreenBanSchema = z.strictObject({
  /** Riot champion ID */
  championId: LoadingScreenChampionIdSchema,
  /** Champion key for image lookup (e.g., "Aatrox") */
  championName: z.string(),
  /** Team that made the ban */
  team: TeamSchema,
});

/**
 * Complete data needed to render a loading screen image.
 * Fully resolved — no external lookups needed during rendering.
 */
export type LoadingScreenData = z.infer<typeof LoadingScreenDataSchema>;
export const LoadingScreenDataSchema = z.strictObject({
  /** Riot game ID from spectator API */
  gameId: z.number().int().positive(),
  /** Parsed queue type (undefined for unknown queues) */
  queueType: QueueTypeSchema.optional(),
  /** Human-readable queue name (e.g., "Ranked Solo", "ARAM") */
  queueDisplayName: z.string(),
  /** Whether the game is ranked (solo or flex) */
  isRanked: z.boolean(),
  /** Layout mode for rendering */
  layout: LoadingScreenLayoutSchema,
  /** Map name (e.g., "Summoner's Rift", "Howling Abyss") */
  mapName: z.string(),
  /** All participants in the game */
  participants: z.array(LoadingScreenParticipantSchema),
  /** Banned champions (empty for ARAM/Arena) */
  bans: z.array(LoadingScreenBanSchema),
  /** Game start timestamp in milliseconds */
  gameStartTime: z.number().int().nonnegative(),
});
