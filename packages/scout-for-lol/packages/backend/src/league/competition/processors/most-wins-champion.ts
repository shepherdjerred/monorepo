import type {
  CompetitionGameVariant,
  MostWinsChampionCriteria,
  RawMatch,
} from "@scout-for-lol/data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "#src/league/competition/processors/types.ts";
import { createWinBasedProcessor } from "#src/league/competition/processors/processor-helpers.ts";

/**
 * Process "Most Wins (Champion)" criteria
 * Counts wins with a specific champion for each participant
 * Optionally filters by queue type
 */
export function processMostWinsChampion(
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  criteria: MostWinsChampionCriteria,
  gameVariant: CompetitionGameVariant,
): LeaderboardEntry[] {
  return createWinBasedProcessor({
    matches,
    participants,
    queues: criteria.queues,
    gameVariant,
    participantFilter: (participantData) =>
      participantData.championId === criteria.championId,
    scoreFn: (wins) => wins, // Score is just wins
    metadataFn: (wins, games, innerCriteria) => ({
      championId: innerCriteria.championId,
      wins,
      games,
      losses: games - wins,
    }),
    criteria,
  });
}
