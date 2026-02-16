import type { Rank } from "@scout-for-lol/data/index";
import { rankToLeaguePoints, RankSchema } from "@scout-for-lol/data/index";
import { z } from "zod";
import type { LeaderboardEntry } from "@scout-for-lol/backend/league/competition/processors/types.ts";
import type { RankedLeaderboardEntry } from "@scout-for-lol/backend/league/competition/leaderboard.ts";

/**
 * Check if two scores are equal
 */
export function scoresAreEqual(a: number | Rank, b: number | Rank): boolean {
  const aNumResult = z.number().safeParse(a);
  const bNumResult = z.number().safeParse(b);

  // Both are numbers
  if (aNumResult.success && bNumResult.success) {
    return aNumResult.data === bNumResult.data;
  }

  const aRankResult = RankSchema.safeParse(a);
  const bRankResult = RankSchema.safeParse(b);

  // Both are Rank objects
  if (aRankResult.success && bRankResult.success) {
    const aLP = rankToLeaguePoints(aRankResult.data);
    const bLP = rankToLeaguePoints(bRankResult.data);
    return aLP === bLP;
  }

  // Mixed types or invalid - not equal
  return false;
}

/**
 * Assign ranks to sorted leaderboard entries
 * Handles ties by giving the same rank and skipping subsequent ranks
 *
 * Example: [100, 80, 80, 60] -> ranks [1, 2, 2, 4]
 */
export function assignRanks(
  entries: LeaderboardEntry[],
): RankedLeaderboardEntry[] {
  if (entries.length === 0) {
    return [];
  }

  const ranked: RankedLeaderboardEntry[] = [];
  let currentRank = 1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }

    // Check for ties with previous entry
    if (i > 0) {
      const previousEntry = entries[i - 1];
      if (previousEntry && !scoresAreEqual(entry.score, previousEntry.score)) {
        currentRank = i + 1;
      }
    }

    ranked.push({
      playerId: entry.playerId,
      playerName: entry.playerName,
      score: entry.score,
      ...(entry.metadata !== undefined && { metadata: entry.metadata }),
      ...(entry.discordId !== undefined && { discordId: entry.discordId }),
      rank: currentRank,
    });
  }

  return ranked;
}
