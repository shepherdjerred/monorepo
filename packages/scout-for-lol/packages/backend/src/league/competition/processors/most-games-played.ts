import type { MostGamesPlayedCriteria, RawMatch } from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";
import { isPlayerInMatch, matchesQueue } from "@scout-for-lol/backend/league/competition/processors/helpers.ts";

/**
 * Process "Most Games Played" criteria
 * Counts the number of games played by each participant in the specified queue
 */
export function processMostGamesPlayed(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  criteria: MostGamesPlayedCriteria,
): LeaderboardEntry[] {
  const gameCounts: Record<number, number> = {};

  // Count games for each player
  for (const match of matches) {
    // Filter by queue
    if (!matchesQueue(match, criteria.queue)) {
      continue;
    }

    for (const participant of participants) {
      if (isPlayerInMatch(participant, match)) {
        const currentCount = gameCounts[participant.id] ?? 0;
        gameCounts[participant.id] = currentCount + 1;
      }
    }
  }

  // Convert to leaderboard entries
  const entries: LeaderboardEntry[] = [];
  for (const participant of participants) {
    const count = gameCounts[participant.id] ?? 0;
    entries.push({
      playerId: participant.id,
      playerName: participant.alias,
      score: count,
      discordId: participant.discordId,
    });
  }

  return entries;
}
