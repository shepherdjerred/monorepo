import type { RawMatch, CompetitionQueueType, RawParticipant } from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";
import {
  getPlayerParticipant,
  isWin,
  matchesQueue,
} from "@scout-for-lol/backend/league/competition/processors/helpers.ts";

/**
 * Win and game counts for a player
 */
export type WinGameCounts = {
  wins: Record<number, number>;
  games: Record<number, number>;
};

/**
 * Count wins and games for each participant
 * @param matches - Array of match data
 * @param participants - Array of participants with their accounts
 * @param queueFilter - Queue type to filter matches by
 * @param participantFilter - Optional filter function to check if participant data should be counted
 * @returns Object with win and game counts per player ID
 */
export function countWinsAndGames(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  queueFilter: CompetitionQueueType,
  participantFilter?: (participantData: RawParticipant) => boolean,
): WinGameCounts {
  const winCounts: Record<number, number> = {};
  const totalGames: Record<number, number> = {};

  for (const match of matches) {
    // Filter by queue
    if (!matchesQueue(match, queueFilter)) {
      continue;
    }

    for (const participant of participants) {
      const participantData = getPlayerParticipant(participant, match);
      if (participantData) {
        // Apply optional filter (e.g., champion filter)
        if (participantFilter && !participantFilter(participantData)) {
          continue;
        }

        const currentWins = winCounts[participant.id] ?? 0;
        const currentGames = totalGames[participant.id] ?? 0;

        if (isWin(participantData)) {
          winCounts[participant.id] = currentWins + 1;
        }
        totalGames[participant.id] = currentGames + 1;
      }
    }
  }

  return { wins: winCounts, games: totalGames };
}

/**
 * Build leaderboard entries from win/game counts
 * @param winCounts - Win counts per player ID
 * @param totalGames - Game counts per player ID
 * @param participants - Array of participants
 * @param scoreFn - Function to calculate score from wins and games
 * @param metadataFn - Function to build metadata object
 * @param minGames - Optional minimum games threshold (players below this are excluded)
 * @returns Array of leaderboard entries
 */
export function buildWinBasedLeaderboard(params: {
  winCounts: Record<number, number>;
  totalGames: Record<number, number>;
  participants: PlayerWithAccounts[];
  scoreFn: (wins: number, games: number) => number;
  metadataFn: (wins: number, games: number) => Record<string, unknown>;
  minGames?: number;
}): LeaderboardEntry[] {
  const { winCounts, totalGames, participants, scoreFn, metadataFn, minGames } = params;
  const entries: LeaderboardEntry[] = [];

  for (const participant of participants) {
    const wins = winCounts[participant.id] ?? 0;
    const games = totalGames[participant.id] ?? 0;

    // Apply minimum games filter if specified
    if (minGames !== undefined && games < minGames) {
      continue;
    }

    entries.push({
      playerId: participant.id,
      playerName: participant.alias,
      score: scoreFn(wins, games),
      metadata: metadataFn(wins, games),
      discordId: participant.discordId,
    });
  }

  return entries;
}
