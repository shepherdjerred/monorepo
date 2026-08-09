import {
  PlayerIdSchema,
  type CachedLeaderboard,
  type CachedLeaderboardEntry,
} from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

export function mergeCompetitionRankHistory(
  lakeHistory: CachedLeaderboard[],
  authoritativeHistory: CachedLeaderboard[],
): CachedLeaderboard[] {
  const byCalculatedAt = new Map(
    lakeHistory.map((snapshot) => [snapshot.calculatedAt, snapshot]),
  );
  for (const snapshot of authoritativeHistory) {
    byCalculatedAt.set(snapshot.calculatedAt, snapshot);
  }
  return [...byCalculatedAt.values()].toSorted((left, right) =>
    left.calculatedAt.localeCompare(right.calculatedAt),
  );
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
