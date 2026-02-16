import type { HighestWinRateCriteria, RawMatch } from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";
import { createWinBasedProcessor } from "@scout-for-lol/backend/league/competition/processors/processor-helpers.ts";

/**
 * Process "Highest Win Rate" criteria
 * Calculates win rate for each participant with minimum games requirement
 * Only includes players who meet the minimum games threshold
 */
export function processHighestWinRate(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  criteria: HighestWinRateCriteria,
): LeaderboardEntry[] {
  // minGames has a default value of 10 in the schema
  const minGames = criteria.minGames;

  return createWinBasedProcessor({
    matches,
    participants,
    queue: criteria.queue,
    scoreFn: (wins, games) => (games > 0 ? wins / games : 0), // Score is win rate
    metadataFn: (wins, games) => ({
      wins,
      games,
      losses: games - wins,
      winRate: games > 0 ? wins / games : 0,
    }),
    criteria,
    minGames, // Apply minimum games filter
  });
}
