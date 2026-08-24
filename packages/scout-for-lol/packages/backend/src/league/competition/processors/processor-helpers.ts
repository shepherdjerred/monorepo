import type {
  RawMatch,
  CompetitionQueueType,
  CompetitionGameVariant,
  RawParticipant,
} from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "#src/league/competition/processors/types.ts";
import {
  countWinsAndGames,
  buildWinBasedLeaderboard,
} from "#src/league/competition/processors/generic-win-counter.ts";

/**
 * Configuration for creating a win-based processor
 */
type WinBasedProcessorConfig<T> = {
  matches: RawMatch[];
  participants: PlayerWithAccounts[];
  queues: readonly CompetitionQueueType[];
  gameVariant: CompetitionGameVariant;
  participantFilter?: (participantData: RawParticipant) => boolean;
  scoreFn: (wins: number, games: number) => number;
  metadataFn: (
    wins: number,
    games: number,
    criteria: T,
  ) => Record<string, unknown>;
  criteria: T;
  minGames?: number;
};

/**
 * Create a win-based leaderboard processor with standardized pattern
 * This reduces duplication across processor files that follow the same structure
 */
export function createWinBasedProcessor<T>(
  config: WinBasedProcessorConfig<T>,
): LeaderboardEntry[] {
  const {
    matches,
    participants,
    queues,
    gameVariant,
    participantFilter,
    scoreFn,
    metadataFn,
    criteria,
    minGames,
  } = config;

  const { wins: winCounts, games: totalGames } = countWinsAndGames(
    matches,
    participants,
    queues,
    gameVariant,
    participantFilter,
  );

  return buildWinBasedLeaderboard({
    winCounts,
    totalGames,
    participants,
    scoreFn,
    metadataFn: (wins, games) => metadataFn(wins, games, criteria),
    ...(minGames !== undefined && { minGames }),
  });
}
