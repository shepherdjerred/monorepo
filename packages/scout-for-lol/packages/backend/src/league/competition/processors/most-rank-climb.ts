import type { MostRankClimbCriteria, Ranks } from "@scout-for-lol/data";
import { rankToLeaguePoints } from "@scout-for-lol/data";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("processors-most-rank-climb");
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@scout-for-lol/backend/league/competition/processors/types.ts";

/**
 * Process "Most Rank Climb" criteria
 * Calculates LP gained between competition start and end for each participant
 *
 * Uses snapshots taken at competition start (START) and end (END)
 */
export function processMostRankClimb(
  participants: PlayerWithAccounts[],
  criteria: MostRankClimbCriteria,
  startSnapshots: Record<number, Ranks>,
  endSnapshots: Record<number, Ranks>,
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const participant of participants) {
    const startRanks = startSnapshots[participant.id];
    const endRanks = endSnapshots[participant.id];

    // Skip participants without complete snapshot data
    // This can happen when:
    // 1. Player was unranked when competition started (no START snapshot)
    // 2. Player hasn't played their placement matches yet (no END snapshot)
    // These players simply don't appear on the leaderboard until they have both snapshots
    if (!startRanks) {
      logger.info(
        `[MostRankClimb] Skipping player ${participant.id.toString()} (${participant.alias}) - no START snapshot (likely unranked at competition start)`,
      );
      continue;
    }

    if (!endRanks) {
      logger.info(
        `[MostRankClimb] Skipping player ${participant.id.toString()} (${participant.alias}) - no END snapshot`,
      );
      continue;
    }

    const startRank =
      criteria.queue === "SOLO" ? startRanks.solo : startRanks.flex;
    const endRank = criteria.queue === "SOLO" ? endRanks.solo : endRanks.flex;

    // Skip if player doesn't have rank data for the specific queue
    if (!startRank) {
      logger.info(
        `[MostRankClimb] Skipping player ${participant.id.toString()} (${participant.alias}) - no ${criteria.queue} rank at START`,
      );
      continue;
    }

    if (!endRank) {
      logger.info(
        `[MostRankClimb] Skipping player ${participant.id.toString()} (${participant.alias}) - no ${criteria.queue} rank at END`,
      );
      continue;
    }

    // Calculate LP delta
    const startLP = rankToLeaguePoints(startRank);
    const endLP = rankToLeaguePoints(endRank);
    const lpGained = endLP - startLP;

    entries.push({
      playerId: participant.id,
      playerName: participant.alias,
      score: lpGained,
      metadata: {
        startRank: startRank,
        endRank: endRank,
        startLP,
        endLP,
      },
      discordId: participant.discordId,
    });
  }

  return entries;
}
