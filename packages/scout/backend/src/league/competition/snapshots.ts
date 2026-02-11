import {
  type CompetitionCriteria,
  type CompetitionId,
  type GamesPlayedSnapshotData,
  getSnapshotSchemaForCriteria,
  type PlayerId,
  type RankSnapshotData,
  type SnapshotType,
  type WinsSnapshotData,
} from "@shepherdjerred/scout-data/index";
import { getParticipants } from "@shepherdjerred/scout-backend/database/competition/participants.ts";
import { fetchSnapshotData } from "@shepherdjerred/scout-backend/league/competition/leaderboard.ts";
import type { PrismaClient } from "@shepherdjerred/scout-backend/generated/prisma/client/index.js";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("competition-snapshots");

// ============================================================================
// Snapshot Creation
// ============================================================================

/**
 * Create a snapshot for a player in a competition
 *
 * @param prisma Prisma client instance
 * @param competitionId Competition ID
 * @param playerId Player ID
 * @param snapshotType Type of snapshot (START or END)
 * @param criteria Competition criteria (determines what data to capture)
 * @throws Error if player not found or data fetching fails
 *
 * This function is idempotent - calling it multiple times with the same
 * parameters will update the existing snapshot instead of creating duplicates
 */
export async function createSnapshot(
  prisma: PrismaClient,
  params: {
    competitionId: CompetitionId;
    playerId: PlayerId;
    snapshotType: SnapshotType;
    criteria: CompetitionCriteria;
  },
): Promise<void> {
  const { competitionId, playerId, snapshotType, criteria } = params;
  logger.info(
    `[Snapshots] Creating ${snapshotType} snapshot for competition ${competitionId.toString()}, player ${playerId.toString()}`,
  );

  // Get player with accounts (include preserves branded types from Prisma)
  const playerData = await prisma.player.findUnique({
    where: { id: playerId },
    include: { accounts: true },
  });

  if (!playerData) {
    throw new Error(`Player ${playerId.toString()} not found`);
  }

  if (playerData.accounts.length === 0) {
    throw new Error(`Player ${playerId.toString()} has no accounts`);
  }

  // Fetch snapshot data based on criteria - pass playerData directly
  // Prisma include returns branded types compatible with PlayerWithAccounts
  // Use 'create_snapshot' purpose to fetch current rank without validation
  const snapshotDataContainer = await fetchSnapshotData({
    prisma,
    competitionId,
    criteria,
    participants: [playerData],
    competitionStatus: "ACTIVE",
    purpose: "create_snapshot",
  });

  // Check if snapshots are needed for this criteria type
  // Some criteria (MOST_GAMES_PLAYED, MOST_WINS_*, etc.) don't use snapshots
  if (snapshotDataContainer === null) {
    logger.info(`[Snapshots] No snapshot needed for ${criteria.type} criteria - skipping`);
    return;
  }

  // Extract this player's rank data from the container
  // fetchSnapshotData returns {startSnapshots, endSnapshots, currentRanks}
  // For creating snapshots, the current rank data is in currentRanks
  const rankData = snapshotDataContainer.currentRanks[playerId];

  // Special handling for MOST_RANK_CLIMB competitions:
  // If creating a START snapshot and player is unranked, skip creating the snapshot.
  // We'll create their START snapshot later when they first become ranked.
  if (criteria.type === "MOST_RANK_CLIMB" && snapshotType === "START") {
    const queue = criteria.queue;
    const hasRank = rankData && (queue === "SOLO" ? rankData.solo : rankData.flex);

    if (!hasRank) {
      logger.info(
        `[Snapshots] Skipping START snapshot for unranked player ${playerId.toString()} in MOST_RANK_CLIMB competition. ` +
          `Will create START snapshot when player completes placement matches.`,
      );
      return;
    }
  }

  // If no rank data was fetched, use empty object (player is unranked)
  const snapshotToStore = rankData ?? {};

  logger.info(`[Snapshots] Extracted rank data for player ${playerId.toString()}:`, JSON.stringify(snapshotToStore));

  // Get the appropriate schema for validation
  const schema = getSnapshotSchemaForCriteria(criteria);

  // Validate the rank data for this specific player
  const validated = schema.parse(snapshotToStore);

  // Upsert the snapshot (for idempotency)
  await prisma.competitionSnapshot.upsert({
    where: {
      competitionId_playerId_snapshotType: {
        competitionId,
        playerId,
        snapshotType,
      },
    },
    update: {
      snapshotData: JSON.stringify(validated),
      snapshotTime: new Date(),
    },
    create: {
      competitionId,
      playerId,
      snapshotType,
      snapshotData: JSON.stringify(validated),
      snapshotTime: new Date(),
    },
  });

  logger.info(`[Snapshots] ✅ Created ${snapshotType} snapshot for player ${playerId.toString()}`);
}

// ============================================================================
// Snapshot Retrieval
// ============================================================================

/**
 * Get a snapshot for a player in a competition
 *
 * @param prisma Prisma client instance
 * @param competitionId Competition ID
 * @param playerId Player ID
 * @param snapshotType Type of snapshot (START or END)
 * @param criteria Competition criteria (needed to parse the snapshot data correctly)
 * @returns Parsed snapshot data, or null if snapshot doesn't exist
 */
export async function getSnapshot(
  prisma: PrismaClient,
  params: {
    competitionId: CompetitionId;
    playerId: PlayerId;
    snapshotType: SnapshotType;
    criteria: CompetitionCriteria;
  },
): Promise<RankSnapshotData | GamesPlayedSnapshotData | WinsSnapshotData | null> {
  const { competitionId, playerId, snapshotType, criteria } = params;
  const snapshot = await prisma.competitionSnapshot.findUnique({
    where: {
      competitionId_playerId_snapshotType: {
        competitionId,
        playerId,
        snapshotType,
      },
    },
  });

  if (!snapshot) {
    return null;
  }

  // Parse the JSON string
  const snapshotData: unknown = JSON.parse(snapshot.snapshotData);

  // Get the appropriate schema for validation
  const schema = getSnapshotSchemaForCriteria(criteria);

  // Validate and return
  return schema.parse(snapshotData);
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Create snapshots for all JOINED participants in a competition
 *
 * @param prisma Prisma client instance
 * @param competitionId Competition ID
 * @param snapshotType Type of snapshot (START or END)
 * @param criteria Competition criteria (determines what data to capture)
 *
 * This function processes participants in parallel for efficiency.
 * Individual failures are logged but don't stop the entire process.
 */
export async function createSnapshotsForAllParticipants(
  prisma: PrismaClient,
  competitionId: CompetitionId,
  snapshotType: SnapshotType,
  criteria: CompetitionCriteria,
): Promise<void> {
  logger.info(`[Snapshots] Creating ${snapshotType} snapshots for competition ${competitionId.toString()}`);

  // Get all JOINED participants
  const participants = await getParticipants(prisma, competitionId, "JOINED", true);

  logger.info(`[Snapshots] Found ${participants.length.toString()} participants`);

  // Create snapshots in parallel
  const results = await Promise.allSettled(
    participants.map((participant) =>
      createSnapshot(prisma, {
        competitionId,
        playerId: participant.playerId,
        snapshotType,
        criteria,
      }),
    ),
  );

  // Log results
  const successful = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  logger.info(`[Snapshots] ✅ Created ${successful.toString()} snapshots`);
  if (failed > 0) {
    logger.warn(`[Snapshots] ⚠️  Failed to create ${failed.toString()} snapshots`);

    // Log individual failures
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const participant = participants[index];
        if (participant) {
          logger.error(
            `[Snapshots] Failed snapshot for player ${participant.playerId.toString()}: ${String(result.reason)}`,
          );
        }
      }
    });
    throw new Error(`Failed to create ${failed.toString()} snapshots`);
  }
}
