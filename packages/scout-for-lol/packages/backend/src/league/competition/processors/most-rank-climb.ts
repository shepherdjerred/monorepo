import type { MostRankClimbCriteria, Ranks } from "@scout-for-lol/data";
import { rankForQueue, rankToLeaguePoints } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("processors-most-rank-climb");
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "#src/league/competition/processors/types.ts";

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

    const components = criteria.queues.flatMap((queue) => {
      const startRank = rankForQueue(startRanks, queue);
      const endRank = rankForQueue(endRanks, queue);
      if (startRank === undefined || endRank === undefined) {
        return [];
      }
      const startLP = rankToLeaguePoints(startRank);
      const endLP = rankToLeaguePoints(endRank);
      return [
        {
          queue,
          startRank,
          endRank,
          startLP,
          endLP,
          lpGained: endLP - startLP,
        },
      ];
    });

    if (components.length === 0) {
      logger.info(
        `[MostRankClimb] Skipping player ${participant.id.toString()} (${participant.alias}) - no selected ladder has complete snapshots`,
      );
      continue;
    }

    const winning = components.reduce((best, component) =>
      component.lpGained > best.lpGained ? component : best,
    );
    const combinedLpGained = components.reduce(
      (total, component) => total + component.lpGained,
      0,
    );

    entries.push({
      playerId: participant.id,
      playerName: participant.alias,
      score:
        criteria.aggregation === "MAX" ? winning.lpGained : combinedLpGained,
      metadata: {
        aggregation: criteria.aggregation,
        winningQueue: winning.queue,
        startRank: winning.startRank,
        endRank: winning.endRank,
        startLP: winning.startLP,
        endLP: winning.endLP,
        components,
      },
      discordId: participant.discordId,
    });
  }

  return entries;
}
