import type { HighestRankCriteria, Ranks } from "@scout-for-lol/data";
import { rankToLeaguePoints } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "#src/league/competition/processors/types.ts";

const logger = createLogger("processors-highest-rank");

/**
 * Process "Highest Rank" criteria
 * Ranks participants by their current rank in the specified queue (SOLO or FLEX).
 *
 * Participants without rank data — either genuinely unranked (no placements
 * done) or with a failed/missing Riot API fetch — are skipped rather than
 * fabricated as Iron IV / 0 LP. This avoids polluting the persisted snapshot
 * (and the downstream line chart) with synthetic zero points when a fetch
 * fails. Mirrors the skip pattern in `most-rank-climb.ts`.
 */
export function processHighestRank(
  participants: PlayerWithAccounts[],
  criteria: HighestRankCriteria,
  ranks: Record<number, Ranks>,
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const participant of participants) {
    const playerRanks = ranks[participant.id];
    const rank =
      criteria.queue === "SOLO" ? playerRanks?.solo : playerRanks?.flex;

    if (!rank) {
      logger.info(
        `[HighestRank] Skipping player ${participant.id.toString()} (${participant.alias}) - no ${criteria.queue} rank data (unranked or fetch failed)`,
      );
      continue;
    }

    entries.push({
      playerId: participant.id,
      playerName: participant.alias,
      score: rank,
      metadata: {
        leaguePoints: rankToLeaguePoints(rank),
      },
      discordId: participant.discordId,
    });
  }

  return entries;
}
