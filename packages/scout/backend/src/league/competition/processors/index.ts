import type { CompetitionCriteria, Ranks, RawMatch } from "@shepherdjerred/scout-data";
import { match } from "ts-pattern";
import { processMostGamesPlayed } from "@shepherdjerred/scout-backend/league/competition/processors/most-games-played.ts";
import { processHighestRank } from "@shepherdjerred/scout-backend/league/competition/processors/highest-rank.ts";
import { processMostRankClimb } from "@shepherdjerred/scout-backend/league/competition/processors/most-rank-climb.ts";
import { processMostWinsPlayer } from "@shepherdjerred/scout-backend/league/competition/processors/most-wins-player.ts";
import { processMostWinsChampion } from "@shepherdjerred/scout-backend/league/competition/processors/most-wins-champion.ts";
import { processHighestWinRate } from "@shepherdjerred/scout-backend/league/competition/processors/highest-win-rate.ts";
import type {
  LeaderboardEntry,
  PlayerWithAccounts,
} from "@shepherdjerred/scout-backend/league/competition/processors/types.ts";

/**
 * Snapshot data that may be needed for rank-based criteria
 */
export type SnapshotData = {
  startSnapshots: Record<number, Ranks>;
  endSnapshots: Record<number, Ranks>;
  currentRanks: Record<number, Ranks>;
};

/**
 * Main dispatcher for processing competition criteria
 * Uses exhaustive pattern matching to ensure all criteria types are handled
 *
 * @param criteria - The competition criteria to process
 * @param matches - Array of match data from S3
 * @param participants - Array of participants with their accounts
 * @param snapshotData - Rank snapshot data (optional, needed for rank-based criteria)
 * @returns Array of leaderboard entries
 */
export function processCriteria(
  criteria: CompetitionCriteria,
  matches: RawMatch[],
  participants: PlayerWithAccounts[],
  snapshotData?: SnapshotData,
): LeaderboardEntry[] {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, (c) => processMostGamesPlayed(matches, participants, c))
    .with({ type: "HIGHEST_RANK" }, (c) => {
      if (!snapshotData) {
        throw new Error("Snapshot data required for HIGHEST_RANK criteria");
      }
      return processHighestRank(participants, c, snapshotData.currentRanks);
    })
    .with({ type: "MOST_RANK_CLIMB" }, (c) => {
      if (!snapshotData) {
        throw new Error("Snapshot data required for MOST_RANK_CLIMB criteria");
      }
      return processMostRankClimb(participants, c, snapshotData.startSnapshots, snapshotData.endSnapshots);
    })
    .with({ type: "MOST_WINS_PLAYER" }, (c) => processMostWinsPlayer(matches, participants, c))
    .with({ type: "MOST_WINS_CHAMPION" }, (c) => processMostWinsChampion(matches, participants, c))
    .with({ type: "HIGHEST_WIN_RATE" }, (c) => processHighestWinRate(matches, participants, c))
    .exhaustive();
}
