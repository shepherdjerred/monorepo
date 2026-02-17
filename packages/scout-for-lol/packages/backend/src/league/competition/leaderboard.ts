import type {
  CompetitionCriteria,
  CompetitionId,
  CompetitionWithCriteria,
  LeaguePuuid,
  Ranks,
  RawMatch,
} from "@scout-for-lol/data/index";
import {
  getCompetitionStatus,
  rankToLeaguePoints,
  RankSchema,
  LeaguePuuidSchema,
  RawSummonerLeagueSchema,
} from "@scout-for-lol/data/index";
import { assignRanks } from "@scout-for-lol/backend/league/competition/leaderboard-ranking.ts";
import { sortBy } from "remeda";
import { match } from "ts-pattern";
import { z } from "zod";
import type { ExtendedPrismaClient } from "@scout-for-lol/backend/database/index.ts";
import { queryMatchesByDateRange } from "@scout-for-lol/backend/storage/s3-query.ts";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";
import {
  processCriteria,
  type SnapshotData,
} from "@scout-for-lol/backend/league/competition/processors/index.ts";
import { getSnapshot } from "@scout-for-lol/backend/league/competition/snapshots.ts";
import { api } from "@scout-for-lol/backend/league/api/api.ts";
import { mapRegionToEnum } from "@scout-for-lol/backend/league/model/region.ts";
import { getRank } from "@scout-for-lol/backend/league/model/rank.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import { withTimeout } from "@scout-for-lol/backend/utils/timeout.ts";

const logger = createLogger("competition-leaderboard");

// ============================================================================
// Types
// ============================================================================

/**
 * Leaderboard entry with rank assigned
 */
export type RankedLeaderboardEntry = LeaderboardEntry & {
  rank: number;
};

// ============================================================================
// Snapshot Data Fetching
// ============================================================================

/**
 * Fetch snapshot data for rank-based criteria
 * Returns null if criteria doesn't need snapshots
 *
 * IMPORTANT: Snapshot behavior differs for ACTIVE vs ENDED competitions:
 * - ENDED competitions: Use stored START/END snapshots (captured when events happened)
 * - ACTIVE competitions: Use stored START snapshot + fetch CURRENT rank from Riot API
 *
 * We NEVER reuse old snapshots to display current state. START/END snapshots are
 * only for historical comparison (e.g., MOST_RANK_CLIMB comparing start vs end).
 *
 * @param options.purpose - Why we're fetching snapshot data:
 *   - 'calculate_leaderboard': Validates that required snapshots exist (throws if missing)
 *   - 'create_snapshot': Just fetches current rank data without validation (used when creating new snapshots)
 */
export async function fetchSnapshotData(options: {
  prisma: ExtendedPrismaClient;
  competitionId: CompetitionId;
  criteria: CompetitionCriteria;
  participants: PlayerWithAccounts[];
  competitionStatus: ReturnType<typeof getCompetitionStatus>;
  purpose: "calculate_leaderboard" | "create_snapshot";
}): Promise<SnapshotData | null> {
  const {
    prisma,
    competitionId,
    criteria,
    participants,
    competitionStatus,
    purpose,
  } = options;
  // Only fetch snapshots for criteria that need them
  const needsSnapshots = match(criteria)
    .with({ type: "HIGHEST_RANK" }, () => true)
    .with({ type: "MOST_RANK_CLIMB" }, () => true)
    .otherwise(() => false);

  if (!needsSnapshots) {
    return null;
  }

  logger.info(
    `[Leaderboard] Fetching snapshot data for ${participants.length.toString()} participants`,
  );

  const startSnapshots: Record<string, Ranks> = {};
  const endSnapshots: Record<string, Ranks> = {};
  const currentRanks: Record<string, Ranks> = {};

  // Fetch snapshots in parallel
  await Promise.all(
    participants.map(async (participant) => {
      const playerId = participant.id;

      // Helper function to fetch current ranks from Riot API
      const fetchCurrentRanks = async (): Promise<
        Record<LeaguePuuid, Ranks>
      > => {
        // Try each account until we get rank data
        const allRanks: Record<LeaguePuuid, Ranks> = {};
        for (const account of participant.accounts) {
          try {
            const region = account.region;
            const response = await withTimeout(
              api.League.byPUUID(account.puuid, mapRegionToEnum(region)),
            );

            // Validate response with Zod schema to ensure proper types
            const validatedResponse = z
              .array(RawSummonerLeagueSchema)
              .parse(response.response);

            const solo = getRank(validatedResponse, "RANKED_SOLO_5x5");
            const flex = getRank(validatedResponse, "RANKED_FLEX_SR");

            allRanks[LeaguePuuidSchema.parse(account.puuid)] = {
              solo: solo,
              flex: flex,
            };
          } catch (error) {
            logger.warn(
              `[Leaderboard] Failed to fetch rank data for player ${playerId.toString()} account ${account.puuid}: ${String(error)}`,
            );
          }
        }
        return allRanks;
      };

      // For MOST_RANK_CLIMB, we need START (stored) and current/end (stored if ended, live if active)
      if (criteria.type === "MOST_RANK_CLIMB") {
        await match(purpose)
          .with("create_snapshot", async () => {
            // Just fetch current rank from Riot API - this will be saved as the snapshot
            const currentRankData = await fetchCurrentRanks();
            const firstAccountRanks = Object.values(currentRankData)[0];
            if (
              firstAccountRanks &&
              (firstAccountRanks.solo ?? firstAccountRanks.flex)
            ) {
              currentRanks[playerId.toString()] = firstAccountRanks;
            }
          })
          .with("calculate_leaderboard", async () => {
            // When calculating leaderboard, we need the START snapshot to compare against
            // Always get START snapshot (captured when competition began)
            const startSnapshot = await getSnapshot(prisma, {
              competitionId,
              playerId,
              snapshotType: "START",
              criteria,
            });

            // Validate START snapshot exists - cannot calculate rank climb without baseline
            if (!startSnapshot) {
              throw new Error(
                `Missing START snapshot for player ${playerId.toString()} in competition ${competitionId.toString()}. ` +
                  `Cannot calculate rank climb without baseline data. Use debug command to create snapshots.`,
              );
            }

            if ("solo" in startSnapshot || "flex" in startSnapshot) {
              const data: Ranks = {};
              if (startSnapshot.solo) {
                data.solo = startSnapshot.solo;
              }
              if (startSnapshot.flex) {
                data.flex = startSnapshot.flex;
              }
              startSnapshots[playerId.toString()] = data;
            }

            await match(competitionStatus)
              .with("ENDED", async () => {
                // For ended competitions, use the stored END snapshot
                const endSnapshot = await getSnapshot(prisma, {
                  competitionId,
                  playerId,
                  snapshotType: "END",
                  criteria,
                });

                // Validate END snapshot exists for ended competitions
                if (!endSnapshot) {
                  throw new Error(
                    `Missing END snapshot for player ${playerId.toString()} in competition ${competitionId.toString()}. ` +
                      `Cannot calculate final rank climb without end data. Use debug command to create snapshots.`,
                  );
                }

                if ("solo" in endSnapshot || "flex" in endSnapshot) {
                  const data: Ranks = {};
                  if (endSnapshot.solo) {
                    data.solo = endSnapshot.solo;
                  }
                  if (endSnapshot.flex) {
                    data.flex = endSnapshot.flex;
                  }
                  endSnapshots[playerId.toString()] = data;
                }
              })
              .with("ACTIVE", "DRAFT", "CANCELLED", async () => {
                // For active/draft/cancelled competitions, fetch CURRENT rank from Riot API
                const currentRankData = await fetchCurrentRanks();
                // Use the first account's ranks (or merge multiple accounts if needed)
                const firstAccountRanks = Object.values(currentRankData)[0];
                if (
                  firstAccountRanks &&
                  (firstAccountRanks.solo ?? firstAccountRanks.flex)
                ) {
                  endSnapshots[playerId.toString()] = firstAccountRanks;
                }
              })
              .exhaustive();
          })
          .exhaustive();
      }

      // For HIGHEST_RANK, we just need current rank
      if (criteria.type === "HIGHEST_RANK") {
        await match(purpose)
          .with("create_snapshot", async () => {
            // Just fetch current rank from Riot API - this will be saved as the snapshot
            const currentRankData = await fetchCurrentRanks();
            const firstAccountRanks = Object.values(currentRankData)[0];
            if (
              firstAccountRanks &&
              (firstAccountRanks.solo ?? firstAccountRanks.flex)
            ) {
              currentRanks[playerId.toString()] = firstAccountRanks;
            }
          })
          .with("calculate_leaderboard", async () => {
            // When calculating leaderboard
            await match(competitionStatus)
              .with("ENDED", async () => {
                // For ended competitions, use the stored END snapshot
                const endSnapshot = await getSnapshot(prisma, {
                  competitionId,
                  playerId,
                  snapshotType: "END",
                  criteria,
                });

                // Validate END snapshot exists for ended competitions
                if (!endSnapshot) {
                  throw new Error(
                    `Missing END snapshot for player ${playerId.toString()} in competition ${competitionId.toString()}. ` +
                      `Cannot determine final rank without end data. Use debug command to create snapshots.`,
                  );
                }

                if ("solo" in endSnapshot || "flex" in endSnapshot) {
                  const data: Ranks = {};
                  if (endSnapshot.solo) {
                    data.solo = endSnapshot.solo;
                  }
                  if (endSnapshot.flex) {
                    data.flex = endSnapshot.flex;
                  }
                  currentRanks[playerId.toString()] = data;
                }
              })
              .with("ACTIVE", "DRAFT", "CANCELLED", async () => {
                // For active/draft/cancelled competitions, fetch CURRENT rank from Riot API
                const currentRankData = await fetchCurrentRanks();
                // Use the first account's ranks (or merge multiple accounts if needed)
                const firstAccountRanks = Object.values(currentRankData)[0];
                if (
                  firstAccountRanks &&
                  (firstAccountRanks.solo ?? firstAccountRanks.flex)
                ) {
                  currentRanks[playerId.toString()] = firstAccountRanks;
                }
              })
              .exhaustive();
          })
          .exhaustive();
      }
    }),
  );

  logger.info(
    `[Leaderboard] Fetched snapshots: ${Object.keys(startSnapshots).length.toString()} start, ${Object.keys(endSnapshots).length.toString()} end, ${Object.keys(currentRanks).length.toString()} current`,
  );

  return {
    startSnapshots,
    endSnapshots,
    currentRanks,
  };
}

// ============================================================================
// Main Leaderboard Calculation
// ============================================================================

/**
 * Calculate leaderboard for a competition
 *
 * Orchestrates the entire pipeline:
 * 1. Validate competition status
 * 2. Get participants
 * 3. Get participant PUUIDs
 * 4. Query matches from S3
 * 5. Fetch snapshot data if needed
 * 6. Process with appropriate criteria processor
 * 7. Sort and assign ranks
 *
 * @param prisma Prisma client instance
 * @param competition Competition with parsed criteria
 * @returns Sorted and ranked leaderboard entries
 * @throws Error if competition is in DRAFT status
 */
export async function calculateLeaderboard(
  prisma: ExtendedPrismaClient,
  competition: CompetitionWithCriteria,
): Promise<RankedLeaderboardEntry[]> {
  const status = getCompetitionStatus(competition);

  logger.info(
    `[Leaderboard] Calculating leaderboard for competition ${competition.id.toString()} (${status})`,
  );

  // DRAFT competitions don't have a leaderboard yet
  if (status === "DRAFT") {
    throw new Error("Cannot calculate leaderboard for DRAFT competition");
  }

  // Get all JOINED participants with their player data and accounts
  const participants = await prisma.competitionParticipant.findMany({
    where: {
      competitionId: competition.id,
      status: "JOINED",
    },
    include: {
      player: {
        include: {
          accounts: true,
        },
      },
    },
  });

  if (participants.length === 0) {
    logger.info("[Leaderboard] No participants found");
    return [];
  }

  // Map to PlayerWithAccounts type
  const players: PlayerWithAccounts[] = participants.map((participant) => ({
    id: participant.player.id,
    alias: participant.player.alias,
    discordId: participant.player.discordId,
    accounts: participant.player.accounts.map((account) => ({
      id: account.id,
      alias: account.alias,
      puuid: account.puuid,
      region: account.region,
    })),
  }));

  logger.info(`[Leaderboard] Found ${players.length.toString()} participants`);

  // Get all PUUIDs for match querying
  const puuids = players.flatMap((p) => p.accounts.map((a) => a.puuid));

  // Determine if this criteria type needs match data
  const needsMatchData = match(competition.criteria)
    .with({ type: "HIGHEST_RANK" }, () => false)
    .with({ type: "MOST_RANK_CLIMB" }, () => false)
    .with({ type: "MOST_GAMES_PLAYED" }, () => true)
    .with({ type: "MOST_WINS_PLAYER" }, () => true)
    .with({ type: "MOST_WINS_CHAMPION" }, () => true)
    .with({ type: "HIGHEST_WIN_RATE" }, () => true)
    .exhaustive();

  let matches: RawMatch[] = [];

  if (needsMatchData) {
    logger.info(
      `[Leaderboard] Querying matches for ${puuids.length.toString()} accounts`,
    );

    // Determine date range
    // For active competitions, use current time as end date
    const startDate = competition.startDate;
    const endDate = competition.endDate ?? new Date();

    // Query matches from S3
    // If no start date (shouldn't happen for non-DRAFT), use empty results
    matches = startDate
      ? await queryMatchesByDateRange(startDate, endDate, puuids)
      : [];

    logger.info(
      `[Leaderboard] Found ${matches.length.toString()} matches in date range`,
    );
  } else {
    logger.info(
      `[Leaderboard] Criteria type ${competition.criteria.type} does not need match data - skipping S3 query`,
    );
  }

  // Fetch snapshot data if needed for rank-based criteria
  const snapshotData = await fetchSnapshotData({
    prisma,
    competitionId: competition.id,
    criteria: competition.criteria,
    participants: players,
    competitionStatus: status,
    purpose: "calculate_leaderboard",
  });

  // Process matches with criteria processor
  const entries = processCriteria(
    competition.criteria,
    matches,
    players,
    snapshotData ?? undefined,
  );

  logger.info(
    `[Leaderboard] Processed ${entries.length.toString()} leaderboard entries`,
  );

  // Sort entries by score
  const sorted = sortBy(entries, [
    (entry) => {
      // Use a comparator that works for both numbers and Ranks
      // We'll sort by converting to a sortable value
      const numResult = z.number().safeParse(entry.score);
      if (numResult.success) {
        return numResult.data;
      }
      // For Rank, validate and use league points as the sort key
      const rankResult = RankSchema.safeParse(entry.score);
      if (rankResult.success) {
        return rankToLeaguePoints(rankResult.data);
      }
      // Fallback for invalid data
      return 0;
    },
    "desc", // Higher is better
  ]);

  // Assign ranks with tie handling
  const ranked = assignRanks(sorted);

  logger.info(
    `[Leaderboard] ✅ Leaderboard calculated with ${ranked.length.toString()} entries`,
  );

  return ranked;
}
