import {
  type CompetitionCriteria,
  type CompetitionId,
  type GamesPlayedSnapshotData,
  getSnapshotSchemaForCriteria,
  type PlayerId,
  type RankSnapshotData,
  type SnapshotType,
  type WinsSnapshotData,
} from "@scout-for-lol/data/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Reading a stored snapshot lives apart from creating one.
 *
 * Creating a snapshot needs `fetchSnapshotData` from `leaderboard.ts`, and
 * `leaderboard.ts` needs to read snapshots back — which made the two modules
 * an eager import cycle. Reading is the smaller half and depends on nothing
 * but Prisma and the criteria schema, so it is the seam.
 */

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
  prisma: ExtendedPrismaClient,
  params: {
    competitionId: CompetitionId;
    playerId: PlayerId;
    snapshotType: SnapshotType;
    criteria: CompetitionCriteria;
  },
): Promise<
  RankSnapshotData | GamesPlayedSnapshotData | WinsSnapshotData | null
> {
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
