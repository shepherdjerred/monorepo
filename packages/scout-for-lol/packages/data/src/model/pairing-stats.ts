import { z } from "zod";

// ============================================================================
// Pairing Stats Types
// ============================================================================

/**
 * Stats for a single pairing between two players
 */
export const PairingRecordSchema = z.object({
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  surrenders: z.number().int().nonnegative(),
});

export type PairingRecord = z.infer<typeof PairingRecordSchema>;

/**
 * Individual player stats (for solo play tracking)
 */
export const IndividualPlayerStatsSchema = z.object({
  alias: z.string(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  surrenders: z.number().int().nonnegative(),
  totalGames: z.number().int().nonnegative(),
});

export type IndividualPlayerStats = z.infer<typeof IndividualPlayerStatsSchema>;

/**
 * Stats for a specific pairing (2+ players)
 * The players array contains sorted aliases for consistent ordering
 */
export const PairingStatsEntrySchema = z.object({
  players: z.array(z.string()).min(1), // Sorted list of player aliases
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  surrenders: z.number().int().nonnegative(),
  totalGames: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1), // 0-1 percentage
});

export type PairingStatsEntry = z.infer<typeof PairingStatsEntrySchema>;

/**
 * Full pairing stats for a server/time period
 */
export const ServerPairingStatsSchema = z.object({
  version: z.literal("v1"),
  serverId: z.string(),
  periodStart: z.string(), // ISO 8601
  periodEnd: z.string(), // ISO 8601
  calculatedAt: z.string(), // ISO 8601
  /**
   * Stats for each player playing alone (solo games where no other tracked player is present)
   */
  individualStats: z.array(IndividualPlayerStatsSchema),
  /**
   * Stats for each unique pairing/group of players
   * Key is a sorted comma-separated list of player aliases
   */
  pairings: z.array(PairingStatsEntrySchema),
  /**
   * Total matches analyzed
   */
  totalMatchesAnalyzed: z.number().int().nonnegative(),
  /**
   * Total matches filtered out (too short, wrong queue, etc.)
   */
  totalMatchesFiltered: z.number().int().nonnegative(),
});

export type ServerPairingStats = z.infer<typeof ServerPairingStatsSchema>;

/**
 * Cached week data stored in S3
 */
export const WeeklyPairingCacheSchema = z.object({
  version: z.literal("v1"),
  serverId: z.string(),
  year: z.number().int().positive(),
  weekNumber: z.number().int().min(1).max(53),
  isComplete: z.boolean(),
  stats: ServerPairingStatsSchema,
});

export type WeeklyPairingCache = z.infer<typeof WeeklyPairingCacheSchema>;

// ============================================================================
// Helper Types for Calculation
// ============================================================================

/**
 * Match outcome for a specific player
 */
export type PlayerMatchOutcome = {
  alias: string;
  puuid: string;
  won: boolean;
  surrendered: boolean;
};

/**
 * Simplified match data for pairing calculation
 */
export type SimplifiedMatch = {
  matchId: string;
  durationSeconds: number;
  queueType: "solo" | "flex" | undefined;
  trackedPlayers: PlayerMatchOutcome[];
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum game duration in seconds to be considered valid (15 minutes)
 */
export const MIN_GAME_DURATION_SECONDS = 15 * 60; // 900 seconds
