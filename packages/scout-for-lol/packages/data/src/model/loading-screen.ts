import { z } from "zod";
import { RanksSchema } from "#src/model/rank.ts";
import { QueueTypeSchema, queueTypeToDisplayString } from "#src/model/state.ts";
import { TeamSchema } from "#src/model/team.ts";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";
import { MapNameSchema } from "#src/model/map.ts";
import { ArenaTeamIdSchema } from "#src/model/arena/arena.ts";

/**
 * Layout mode determines how participants are arranged visually.
 * - "standard": 5v5 with two columns (ranked, draft, quickplay, swiftplay, brawl, URF, custom, clash)
 * - "aram": 5v5 with two columns, no bans (ARAM / ARAM clash)
 * - "arena": 8 teams of 2 in a grid layout
 */
export type LoadingScreenLayout = z.infer<typeof LoadingScreenLayoutSchema>;
export const LoadingScreenLayoutSchema = z.enum(["standard", "aram", "arena"]);

/**
 * Branded type for Riot game IDs (from spectator API).
 */
export type GameId = z.infer<typeof GameIdSchema>;
export const GameIdSchema = z.number().int().positive().brand<"GameId">();

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
 * Discriminated team assignment:
 * - "blue" or "red" for standard 5v5 / ARAM
 * - { arenaTeam: 1..8 } for Arena mode
 *
 * Reuses ArenaTeamIdSchema from the arena model to avoid duplication.
 */
export type LoadingScreenTeam = z.infer<typeof LoadingScreenTeamSchema>;
export const LoadingScreenTeamSchema = z.union([
  TeamSchema,
  z.strictObject({ arenaTeam: ArenaTeamIdSchema }),
]);

/**
 * Branded display name for a queue (e.g., "ranked solo", "ARAM").
 * Always derived from QueueType via queueTypeToDisplayString.
 */
export type QueueDisplayName = z.infer<typeof QueueDisplayNameSchema>;
export const QueueDisplayNameSchema = z
  .string()
  .min(1)
  .brand<"QueueDisplayName">();

/**
 * A single participant on the loading screen.
 * Contains all info needed to render one player card.
 */
export type LoadingScreenParticipant = z.infer<
  typeof LoadingScreenParticipantSchema
>;
export const LoadingScreenParticipantSchema = z.strictObject({
  /** Riot PUUID — null for participants we cannot identify (rare, e.g., bots) */
  puuid: LeaguePuuidSchema.nullable(),
  /** In-game Riot ID (e.g., "Cain#3276") */
  summonerName: z.string().min(1),
  /** Champion key for image lookup (e.g., "Aatrox", "LeeSin") */
  championName: z.string().min(1),
  /** Human-readable champion name (e.g., "Lee Sin") */
  championDisplayName: z.string().min(1),
  /** Skin number for loading screen art (0 = default) */
  skinNum: z.number().int().nonnegative(),
  /** Team assignment (discriminated by layout) */
  team: LoadingScreenTeamSchema,
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
  championName: z.string().min(1),
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
  gameId: GameIdSchema,
  /** Parsed queue type */
  queueType: QueueTypeSchema,
  /** Human-readable queue name (e.g., "ranked solo", "ARAM") */
  queueDisplayName: QueueDisplayNameSchema,
  /** Whether the game is ranked (solo or flex) */
  isRanked: z.boolean(),
  /** Layout mode for rendering */
  layout: LoadingScreenLayoutSchema,
  /** Map name */
  mapName: MapNameSchema,
  /** All participants in the game */
  participants: z.array(LoadingScreenParticipantSchema),
  /** Banned champions (empty for ARAM/Arena) */
  bans: z.array(LoadingScreenBanSchema),
  /** Game start timestamp in milliseconds */
  gameStartTime: z.number().int().nonnegative(),
});

/**
 * Build a QueueDisplayName from a QueueType, ensuring we never have
 * raw strings flowing through the system.
 */
export function makeQueueDisplayName(
  queueType: z.infer<typeof QueueTypeSchema>,
): QueueDisplayName {
  return QueueDisplayNameSchema.parse(queueTypeToDisplayString(queueType));
}
