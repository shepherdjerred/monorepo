import type { HighestRankCriteria, Rank, Ranks } from "@shepherdjerred/scout-data";
import { rankToLeaguePoints } from "@shepherdjerred/scout-data";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@shepherdjerred/scout-backend/league/competition/processors/types.ts";

/**
 * Process "Highest Rank" criteria
 * Ranks participants by their current rank in the specified queue (SOLO or FLEX)
 *
 * Note: This processor requires rank data to be provided separately,
 * as ranks come from snapshots or live API calls, not from match history
 */
export function processHighestRank(
  participants: PlayerWithAccounts[],
  criteria: HighestRankCriteria,
  ranks: Record<number, Ranks>,
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const participant of participants) {
    const playerRanks = ranks[participant.id];
    const rank = criteria.queue === "SOLO" ? playerRanks?.solo : playerRanks?.flex;

    if (rank) {
      entries.push({
        playerId: participant.id,
        playerName: participant.alias,
        score: rank,
        metadata: {
          leaguePoints: rankToLeaguePoints(rank),
        },
        discordId: participant.discordId,
      });
    } else {
      // Player has no rank - they're unranked (Iron IV, 0 LP)
      const unrankedRank: Rank = {
        tier: "iron",
        division: 4,
        lp: 0,
        wins: 0,
        losses: 0,
      };
      entries.push({
        playerId: participant.id,
        playerName: participant.alias,
        score: unrankedRank,
        metadata: {
          leaguePoints: 0,
        },
        discordId: participant.discordId,
      });
    }
  }

  return entries;
}
