import {
  PlayerIdSchema,
  type CachedLeaderboard,
  type CachedLeaderboardEntry,
} from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-types.ts";

export function mergeCompetitionRankHistory(
  lakeHistory: CachedLeaderboard[],
  authoritativeHistory: CachedLeaderboard[],
): CachedLeaderboard[] {
  const bySnapshotDate = new Map<string, CachedLeaderboard>();
  for (const snapshot of lakeHistory.toSorted(compareSnapshots)) {
    bySnapshotDate.set(snapshotDate(snapshot), snapshot);
  }
  for (const snapshot of authoritativeHistory.toSorted(compareSnapshots)) {
    bySnapshotDate.set(snapshotDate(snapshot), snapshot);
  }
  return [...bySnapshotDate.values()].toSorted((left, right) =>
    left.calculatedAt.localeCompare(right.calculatedAt),
  );
}

function snapshotDate(snapshot: CachedLeaderboard): string {
  return snapshot.calculatedAt.slice(0, 10);
}

function compareSnapshots(
  left: CachedLeaderboard,
  right: CachedLeaderboard,
): number {
  return left.calculatedAt.localeCompare(right.calculatedAt);
}

export function standingsFromResult(
  result: ReportQueryResult,
): CachedLeaderboardEntry[] {
  return result.rows.map((row, index) => {
    if (
      row.mentionIdentity?.kind !== "player" ||
      row.mentionIdentity.playerId === null
    ) {
      throw new TypeError(
        `Competition standings row "${row.label}" is missing its player identity.`,
      );
    }
    const score = row.values[0]?.value;
    if (typeof score !== "number") {
      throw new TypeError(
        `Competition standings row "${row.label}" is missing its numeric score.`,
      );
    }
    return {
      playerId: PlayerIdSchema.parse(row.mentionIdentity.playerId),
      playerName: row.label,
      score,
      rank: index + 1,
    };
  });
}
