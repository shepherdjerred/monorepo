import { match } from "ts-pattern";
import { z } from "zod";
import { RankSchema } from "@scout-for-lol/data/model/rank";
import { getSeasonById } from "@scout-for-lol/data/seasons";
import type { Competition } from "@scout-for-lol/backend/generated/prisma/client/index.js";

// ============================================================================
// Branded ID Types
// ============================================================================

export type CompetitionId = z.infer<typeof CompetitionIdSchema>;
export const CompetitionIdSchema = z
  .number()
  .int()
  .positive()
  .brand("CompetitionId");

export type ParticipantId = z.infer<typeof ParticipantIdSchema>;
export const ParticipantIdSchema = z
  .number()
  .int()
  .positive()
  .brand("ParticipantId");

export type SnapshotId = z.infer<typeof SnapshotIdSchema>;
export const SnapshotIdSchema = z.number().int().positive().brand("SnapshotId");

export type SubscriptionId = z.infer<typeof SubscriptionIdSchema>;
export const SubscriptionIdSchema = z
  .number()
  .int()
  .positive()
  .brand("SubscriptionId");

export type PermissionId = z.infer<typeof PermissionIdSchema>;
export const PermissionIdSchema = z
  .number()
  .int()
  .positive()
  .brand("PermissionId");

export type PermissionErrorId = z.infer<typeof PermissionErrorIdSchema>;
export const PermissionErrorIdSchema = z
  .number()
  .int()
  .positive()
  .brand("PermissionErrorId");

// ============================================================================
// Enums
// ============================================================================

export type CompetitionVisibility = z.infer<typeof CompetitionVisibilitySchema>;
export const CompetitionVisibilitySchema = z.enum([
  "OPEN",
  "INVITE_ONLY",
  "SERVER_WIDE",
]);

export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;
export const ParticipantStatusSchema = z.enum(["INVITED", "JOINED", "LEFT"]);

export type SnapshotType = z.infer<typeof SnapshotTypeSchema>;
export const SnapshotTypeSchema = z.enum(["START", "END"]);

export type PermissionType = z.infer<typeof PermissionTypeSchema>;
export const PermissionTypeSchema = z.enum(["CREATE_COMPETITION"]);

export type CompetitionQueueType = z.infer<typeof CompetitionQueueTypeSchema>;
export const CompetitionQueueTypeSchema = z.enum([
  "SOLO",
  "FLEX",
  "RANKED_ANY",
  "ARENA",
  "ARAM",
  "URF",
  "ARURF",
  "QUICKPLAY",
  "SWIFTPLAY",
  "BRAWL",
  "DRAFT_PICK",
  "CUSTOM",
  "ALL",
]);

// ============================================================================
// Competition Criteria (Discriminated Union)
// ============================================================================

/**
 * Criteria: Most games played in specified queue
 */
export const MostGamesPlayedCriteriaSchema = z.object({
  type: z.literal("MOST_GAMES_PLAYED"),
  queue: CompetitionQueueTypeSchema,
});

export type MostGamesPlayedCriteria = z.infer<
  typeof MostGamesPlayedCriteriaSchema
>;

/**
 * Criteria: Highest rank achieved in SOLO or FLEX queue
 */
export const HighestRankCriteriaSchema = z.object({
  type: z.literal("HIGHEST_RANK"),
  queue: z.enum(["SOLO", "FLEX"]), // Only ranked queues
});

export type HighestRankCriteria = z.infer<typeof HighestRankCriteriaSchema>;

/**
 * Criteria: Most rank climb (LP gained) in SOLO or FLEX queue
 */
export const MostRankClimbCriteriaSchema = z.object({
  type: z.literal("MOST_RANK_CLIMB"),
  queue: z.enum(["SOLO", "FLEX"]), // Only ranked queues
});

export type MostRankClimbCriteria = z.infer<typeof MostRankClimbCriteriaSchema>;

/**
 * Criteria: Most wins in specified queue (for a player)
 */
export const MostWinsPlayerCriteriaSchema = z.object({
  type: z.literal("MOST_WINS_PLAYER"),
  queue: CompetitionQueueTypeSchema,
});

export type MostWinsPlayerCriteria = z.infer<
  typeof MostWinsPlayerCriteriaSchema
>;

export const ChampionIdSchema = z.number().int().positive().brand("ChampionId");
export type ChampionId = z.infer<typeof ChampionIdSchema>;

/**
 * Criteria: Most wins with a specific champion
 * Queue is optional - if not specified, counts wins across all queues
 */
export const MostWinsChampionCriteriaSchema = z.object({
  type: z.literal("MOST_WINS_CHAMPION"),
  championId: ChampionIdSchema,
  queue: CompetitionQueueTypeSchema.optional(),
});

export type MostWinsChampionCriteria = z.infer<
  typeof MostWinsChampionCriteriaSchema
>;

/**
 * Criteria: Highest win rate (minimum games required)
 */
export const HighestWinRateCriteriaSchema = z.object({
  type: z.literal("HIGHEST_WIN_RATE"),
  minGames: z.number().int().positive().default(10),
  queue: CompetitionQueueTypeSchema,
});

export type HighestWinRateCriteria = z.infer<
  typeof HighestWinRateCriteriaSchema
>;

/**
 * Discriminated union of all competition criteria types.
 * The 'type' field is the discriminator that allows TypeScript to narrow the type.
 */
export const CompetitionCriteriaSchema = z.discriminatedUnion("type", [
  MostGamesPlayedCriteriaSchema,
  HighestRankCriteriaSchema,
  MostRankClimbCriteriaSchema,
  MostWinsPlayerCriteriaSchema,
  MostWinsChampionCriteriaSchema,
  HighestWinRateCriteriaSchema,
]);

export type CompetitionCriteria = z.infer<typeof CompetitionCriteriaSchema>;

// ============================================================================
// Competition Status (Calculated, Not Stored)
// ============================================================================

export type CompetitionStatus = "DRAFT" | "ACTIVE" | "ENDED" | "CANCELLED";

/**
 * Calculate competition status based on dates and cancellation flag.
 * This is a pure function with no side effects.
 *
 * Note: When competitions are loaded via parseCompetition(), season-based
 * competitions will have their startDate/endDate populated from the season,
 * so this function should always have dates to work with.
 *
 * Rules:
 * 1. If isCancelled === true → CANCELLED (regardless of dates)
 * 2. If endDate is in the past → ENDED
 * 3. If startDate is in the future → DRAFT
 * 4. If startDate <= now < endDate → ACTIVE
 */
export function getCompetitionStatus(
  competition: Competition | CompetitionWithCriteria,
): CompetitionStatus {
  // Rule 1: Cancellation overrides everything
  if (competition.isCancelled) {
    return "CANCELLED";
  }

  const now = new Date();

  // Handle competitions with dates (both fixed-date and season-based)
  if (competition.startDate !== null && competition.endDate !== null) {
    const startDate = competition.startDate;
    const endDate = competition.endDate;

    // Rule 2: Competition has ended
    if (now >= endDate) {
      return "ENDED";
    }

    // Rule 3: Competition hasn't started yet
    if (now < startDate) {
      return "DRAFT";
    }

    // Rule 4: Competition is active
    return "ACTIVE";
  }

  // Edge case: season-based competition with invalid/missing season
  // This shouldn't happen if parseCompetition() was used, but handle gracefully
  if (competition.seasonId !== null) {
    return "DRAFT";
  }

  // Invalid state: no dates and no seasonId
  throw new Error(
    "Competition must have either (startDate AND endDate) OR seasonId",
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format queue type to human-readable string
 */
export function competitionQueueTypeToString(
  queueType: CompetitionQueueType,
): string {
  return match(queueType)
    .with("SOLO", () => "Solo Queue")
    .with("FLEX", () => "Flex Queue")
    .with("RANKED_ANY", () => "Ranked (Any)")
    .with("ARENA", () => "Arena")
    .with("ARAM", () => "ARAM")
    .with("URF", () => "URF")
    .with("ARURF", () => "ARURF")
    .with("QUICKPLAY", () => "Quickplay")
    .with("SWIFTPLAY", () => "Swiftplay")
    .with("BRAWL", () => "Brawl")
    .with("DRAFT_PICK", () => "Draft Pick")
    .with("CUSTOM", () => "Custom")
    .with("ALL", () => "All Queues")
    .exhaustive();
}

/**
 * Format visibility to human-readable string
 */
export function visibilityToString(visibility: CompetitionVisibility): string {
  return match(visibility)
    .with("OPEN", () => "Open to All")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .exhaustive();
}

/**
 * Format participant status to human-readable string
 */
export function participantStatusToString(status: ParticipantStatus): string {
  return match(status)
    .with("INVITED", () => "Invited")
    .with("JOINED", () => "Joined")
    .with("LEFT", () => "Left")
    .exhaustive();
}

// ============================================================================
// Competition Parsing - Database to Domain Type
// ============================================================================

/**
 * Competition with parsed criteria (domain type)
 * This is what we use in application code
 */
export type CompetitionWithCriteria = Omit<
  Competition,
  "criteriaType" | "criteriaConfig"
> & {
  criteria: CompetitionCriteria;
};

/**
 * Parse raw competition from database to domain type
 * Validates and parses criteriaConfig JSON
 * Transparently populates startDate/endDate from seasonId if present
 *
 * @throws {Error} if criteriaConfig is invalid JSON or doesn't match schema
 */
export function parseCompetition(raw: Competition): CompetitionWithCriteria {
  // Parse the JSON config
  let criteriaConfig: unknown;
  try {
    criteriaConfig = JSON.parse(raw.criteriaConfig);
  } catch (error) {
    throw new Error(
      `Invalid criteriaConfig JSON for competition ${raw.id.toString()}: ${String(error)}`,
    );
  }

  // Validate it's an object using Zod
  const objectResult = z
    .record(z.string(), z.unknown())
    .safeParse(criteriaConfig);
  if (!objectResult.success) {
    throw new Error(
      `criteriaConfig must be an object for competition ${raw.id.toString()}`,
    );
  }

  // Combine type + config and validate
  const criteriaData = {
    type: raw.criteriaType,
    ...objectResult.data,
  };

  const result = CompetitionCriteriaSchema.safeParse(criteriaData);
  if (!result.success) {
    throw new Error(
      `Invalid criteria for competition ${raw.id.toString()}: ${result.error.message}`,
    );
  }

  const { criteriaType: _type, criteriaConfig: _config, ...rest } = raw;

  // Transparently populate dates from season if seasonId is set
  let startDate = raw.startDate;
  let endDate = raw.endDate;

  if (raw.seasonId !== null && raw.startDate === null && raw.endDate === null) {
    const season = getSeasonById(raw.seasonId);
    if (season) {
      startDate = season.startDate;
      endDate = season.endDate;
    }
  }

  return {
    ...rest,
    startDate,
    endDate,
    criteria: result.data,
  };
}

// ============================================================================
// Snapshot Data Schemas
// ============================================================================

/**
 * Rank data for snapshot - captures tier, division, and LP for solo/flex
 *
 * Uses existing RankSchema for consistency and to leverage existing utilities:
 * - tier: lowercase enum ("iron", "bronze", "gold", etc.)
 * - division: numeric 1-4 (4=IV, 3=III, 2=II, 1=I)
 * - lp: league points (0-100 for most ranks, unlimited for Master+)
 * - wins/losses: included for additional statistics
 *
 * Note: When fetching from Riot API, convert:
 * - API tier "GOLD" → "gold"
 * - API rank "II" → division 2
 */
export type RankSnapshotData = z.infer<typeof RankSnapshotDataSchema>;
export const RankSnapshotDataSchema = z.object({
  solo: RankSchema.optional(),
  flex: RankSchema.optional(),
});

/**
 * Games played data for snapshot - captures game counts per queue
 */
export type GamesPlayedSnapshotData = z.infer<
  typeof GamesPlayedSnapshotDataSchema
>;
export const GamesPlayedSnapshotDataSchema = z.object({
  soloGames: z.number().int().nonnegative(),
  flexGames: z.number().int().nonnegative(),
  arenaGames: z.number().int().nonnegative(),
  aramGames: z.number().int().nonnegative(),
});

/**
 * Wins data for snapshot - captures wins and total games, optionally per champion/queue
 */
export type WinsSnapshotData = z.infer<typeof WinsSnapshotDataSchema>;
export const WinsSnapshotDataSchema = z.object({
  wins: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  championId: ChampionIdSchema.optional(),
  queue: CompetitionQueueTypeSchema.optional(),
});

// ============================================================================
// Snapshot Schema Factory
// ============================================================================

/**
 * Returns the appropriate snapshot schema based on criteria type.
 * Uses exhaustive pattern matching to ensure all criteria types are handled.
 */
export function getSnapshotSchemaForCriteria(
  criteria: CompetitionCriteria,
):
  | typeof RankSnapshotDataSchema
  | typeof GamesPlayedSnapshotDataSchema
  | typeof WinsSnapshotDataSchema {
  return match(criteria)
    .with({ type: "HIGHEST_RANK" }, () => RankSnapshotDataSchema)
    .with({ type: "MOST_RANK_CLIMB" }, () => RankSnapshotDataSchema)
    .with({ type: "MOST_GAMES_PLAYED" }, () => GamesPlayedSnapshotDataSchema)
    .with({ type: "MOST_WINS_PLAYER" }, () => WinsSnapshotDataSchema)
    .with({ type: "MOST_WINS_CHAMPION" }, () => WinsSnapshotDataSchema)
    .with({ type: "HIGHEST_WIN_RATE" }, () => WinsSnapshotDataSchema)
    .exhaustive();
}

// ============================================================================
// Cached Leaderboard Schema
// ============================================================================

export const PlayerIdSchema = z.number().int().positive().brand("PlayerId");
export type PlayerId = z.infer<typeof PlayerIdSchema>;

export const AccountIdSchema = z.number().int().positive().brand("AccountId");
export type AccountId = z.infer<typeof AccountIdSchema>;

/**
 * Leaderboard entry stored in cache
 * Supports both numeric scores and Rank objects
 */
export const CachedLeaderboardEntrySchema = z.object({
  playerId: PlayerIdSchema,
  playerName: z.string(),
  score: z.union([z.number(), RankSchema]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  rank: z.number().int().positive(),
});

export type CachedLeaderboardEntry = z.infer<
  typeof CachedLeaderboardEntrySchema
>;

/**
 * Cached leaderboard data stored in S3
 *
 * Schema includes:
 * - version: For future format changes (currently v1)
 * - competitionId: Which competition this leaderboard belongs to
 * - calculatedAt: When this leaderboard was computed (ISO 8601 timestamp)
 * - entries: The leaderboard entries with ranks
 *
 * S3 Storage Strategy:
 * - Current leaderboard: leaderboards/competition-{id}/current.json
 * - Historical snapshots: leaderboards/competition-{id}/snapshots/YYYY-MM-DD.json
 *
 * This allows:
 * - Fast access to current leaderboard
 * - Historical analysis of leaderboard changes over time
 * - Version migration if we need to change the format later
 */
export const CachedLeaderboardSchema = z.object({
  version: z.literal("v1"),
  competitionId: CompetitionIdSchema,
  calculatedAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid ISO 8601 datetime",
  }), // ISO 8601 timestamp
  entries: z.array(CachedLeaderboardEntrySchema),
});

export type CachedLeaderboard = z.infer<typeof CachedLeaderboardSchema>;
