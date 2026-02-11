import type { RawMatch, CompetitionQueueType, RawParticipant } from "@shepherdjerred/scout-data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@shepherdjerred/scout-backend/league/competition/processors/types.ts";
import {
  countWinsAndGames,
  buildWinBasedLeaderboard,
} from "@shepherdjerred/scout-backend/league/competition/processors/generic-win-counter.ts";

/**
 * Configuration for creating a win-based processor
 */
type WinBasedProcessorConfig<T> = {
  matches: RawMatch[];
  participants: PlayerWithAccounts[];
  queue: CompetitionQueueType;
  participantFilter?: (participantData: RawParticipant) => boolean;
  scoreFn: (wins: number, games: number) => number;
  metadataFn: (wins: number, games: number, criteria: T) => Record<string, unknown>;
  criteria: T;
  minGames?: number;
};

/**
 * Create a win-based leaderboard processor with standardized pattern
 * This reduces duplication across processor files that follow the same structure
 */
export function createWinBasedProcessor<T>(config: WinBasedProcessorConfig<T>): LeaderboardEntry[] {
  const { matches, participants, queue, participantFilter, scoreFn, metadataFn, criteria, minGames } = config;

  const { wins: winCounts, games: totalGames } = countWinsAndGames(matches, participants, queue, participantFilter);

  return buildWinBasedLeaderboard({
    winCounts,
    totalGames,
    participants,
    scoreFn,
    metadataFn: (wins, games) => metadataFn(wins, games, criteria),
    ...(minGames !== undefined && { minGames }),
  });
}
