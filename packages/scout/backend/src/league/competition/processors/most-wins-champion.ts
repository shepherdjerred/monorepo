import type { MostWinsChampionCriteria, RawMatch } from "@shepherdjerred/scout-data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@shepherdjerred/scout-backend/league/competition/processors/types.ts";
import { createWinBasedProcessor } from "@shepherdjerred/scout-backend/league/competition/processors/processor-helpers.ts";

/**
 * Process "Most Wins (Champion)" criteria
 * Counts wins with a specific champion for each participant
 * Optionally filters by queue type
 */
export function processMostWinsChampion(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  criteria: MostWinsChampionCriteria,
): LeaderboardEntry[] {
  return createWinBasedProcessor({
    matches,
    participants,
    queue: criteria.queue ?? "ALL",
    participantFilter: (participantData) => participantData.championId === criteria.championId,
    scoreFn: (wins) => wins, // Score is just wins
    metadataFn: (wins, games, criteria) => ({
      championId: criteria.championId,
      wins,
      games,
      losses: games - wins,
    }),
    criteria,
  });
}
