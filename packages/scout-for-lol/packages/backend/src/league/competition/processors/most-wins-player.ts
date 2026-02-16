import type { MostWinsPlayerCriteria, RawMatch } from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";
import { createWinBasedProcessor } from "@scout-for-lol/backend/league/competition/processors/processor-helpers.ts";

/**
 * Process "Most Wins (Player)" criteria
 * Counts the total number of wins by each participant in the specified queue
 */
export function processMostWinsPlayer(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  criteria: MostWinsPlayerCriteria,
): LeaderboardEntry[] {
  return createWinBasedProcessor({
    matches,
    participants,
    queue: criteria.queue,
    scoreFn: (wins) => wins, // Score is just wins
    metadataFn: (wins, games) => ({
      wins,
      games,
      losses: games - wins,
    }),
    criteria,
  });
}
