import { z } from "zod";
import { ChampionSchema } from "@shepherdjerred/scout-data/model/champion";
import { PlayerConfigEntrySchema } from "@shepherdjerred/scout-data/model/player-config";
import { match } from "ts-pattern";
import { AugmentSchema } from "@shepherdjerred/scout-data/model/arena/augment";

export type PlayerMetrics = z.infer<typeof PlayerMetricsSchema>;
export const PlayerMetricsSchema = z.strictObject({
  playerScore0: z.number(), // Likely kills/eliminations
  playerScore1: z.number(), // Likely assists
  playerScore2: z.number(), // Possibly damage per minute
  playerScore3: z.number(), // Unknown percentage metric
  playerScore4: z.number(), // Unknown - could be survival time/rounds
  playerScore5: z.number(), // Unknown damage-related metric
  playerScore6: z.number(), // Unknown - possibly total damage
  playerScore7: z.number(), // Unknown - possibly economy metric
  playerScore8: z.number(), // Unknown percentage metric
  playerScore9: z.number().optional(), // Unknown - likely unused
  playerScore10: z.number().optional(), // Unknown - likely unused
  playerScore11: z.number().optional(), // Unknown - likely unused
});

export type TeamSupportMetrics = z.infer<typeof TeamSupportMetricsSchema>;
export const TeamSupportMetricsSchema = z.strictObject({
  damageShieldedOnTeammate: z.number(),
  healsOnTeammate: z.number(),
  damageTakenPercentage: z.number(),
});

export type ArenaChampion = z.infer<typeof ArenaChampionSchema>;
export const ArenaChampionSchema = ChampionSchema.omit({
  lane: true,
  spells: true,
  visionScore: true,
  creepScore: true,
  runes: true,
}).extend({
  augments: z.array(AugmentSchema).max(6),
  // TODO(https://github.com/shepherdjerred/scout-for-lol/issues/188): perhaps these are in normal games, too
  arenaMetrics: PlayerMetricsSchema,
  teamSupport: TeamSupportMetricsSchema,
});

// Arena team types
export type ArenaTeamId = z.infer<typeof ArenaTeamIdSchema>;
export const ArenaTeamIdSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

export type ArenaPlacement = z.infer<typeof ArenaPlacementSchema>;
export const ArenaPlacementSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

/**
 * Mapping of Arena team IDs to their display names.
 * Teams are named after League of Legends jungle monsters.
 */
export const ARENA_TEAM_NAMES: Record<ArenaTeamId, string> = {
  1: "Minion",
  2: "Krug",
  3: "Raptor",
  4: "Wolf",
  5: "Gromp",
  6: "Scuttle",
  7: "Herald",
  8: "Baron",
} as const;

/**
 * Get the display name for an Arena team ID.
 */
export function getArenaTeamName(teamId: ArenaTeamId): string {
  return ARENA_TEAM_NAMES[teamId];
}

export type ArenaTeam = z.infer<typeof ArenaTeamSchema>;
export const ArenaTeamSchema = z.strictObject({
  teamId: ArenaTeamIdSchema,
  players: z.array(ArenaChampionSchema).length(2),
  placement: ArenaPlacementSchema,
});

// Arena-specific player data
export type ArenaMatchPlayer = z.infer<typeof ArenaMatchPlayerSchema>;
export const ArenaMatchPlayerSchema = z.strictObject({
  playerConfig: PlayerConfigEntrySchema,
  wins: z.number().nonnegative().optional(),
  losses: z.number().nonnegative().optional(),
  placement: ArenaPlacementSchema,
  champion: ArenaChampionSchema,
  teamId: ArenaTeamIdSchema,
  teammate: ArenaChampionSchema,
});

export type ArenaMatch = z.infer<typeof ArenaMatchSchema>;
export const ArenaMatchSchema = z.strictObject({
  durationInSeconds: z.number().nonnegative(),
  queueType: z.literal("arena"),
  players: z.array(ArenaMatchPlayerSchema),
  teams: z.array(ArenaTeamSchema).length(8),
});

export function formatArenaPlacement(placement: ArenaPlacement) {
  return match(placement)
    .with(1, () => "1st")
    .with(2, () => "2nd")
    .with(3, () => "3rd")
    .with(4, () => "4th")
    .with(5, () => "5th")
    .with(6, () => "6th")
    .with(7, () => "7th")
    .with(8, () => "8th")
    .exhaustive();
}
