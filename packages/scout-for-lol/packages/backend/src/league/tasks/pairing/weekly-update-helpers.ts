import type {
  ServerPairingStats,
  IndividualPlayerStats,
} from "@scout-for-lol/data/index";
import { calculatePairingStats } from "./calculate-pairings.ts";
import type { ServerPlayer } from "./get-server-players.ts";

// Minimum games required for a pairing to be included in rankings
const MIN_GAMES_FOR_RANKING = 10;

/**
 * Find players who surrender the most (sorted by surrender rate, then by count)
 * Requires minimum games to qualify for ranking
 */
export function findSurrenderLeaders(
  individualStats: IndividualPlayerStats[],
): IndividualPlayerStats[] {
  if (individualStats.length === 0) {
    return [];
  }

  const playersWithSurrenders = individualStats
    .filter((p) => p.surrenders > 0 && p.totalGames >= MIN_GAMES_FOR_RANKING)
    .map((p) => ({
      ...p,
      surrenderRate: p.surrenders / p.totalGames,
    }))
    .toSorted((a, b) => {
      if (b.surrenderRate !== a.surrenderRate) {
        return b.surrenderRate - a.surrenderRate;
      }
      return b.surrenders - a.surrenders;
    });

  if (playersWithSurrenders.length === 0) {
    return [];
  }

  const topRate = playersWithSurrenders[0]?.surrenderRate ?? 0;
  const leaders = playersWithSurrenders
    .filter((p) => Math.abs(p.surrenderRate - topRate) < 0.001)
    .toSorted((a, b) => a.alias.localeCompare(b.alias));

  return leaders;
}

/**
 * Options for calculating stats across all game modes
 */
export type CalculateAllModeStatsOptions = {
  players: ServerPlayer[];
  startDate: Date;
  endDate: Date;
  serverId: string;
};

/**
 * Calculate stats for all game modes
 */
export async function calculateAllModeStats(
  options: CalculateAllModeStatsOptions,
): Promise<{
  ranked: ServerPairingStats;
  arena: ServerPairingStats;
  aram: ServerPairingStats;
}> {
  const { players, startDate, endDate, serverId } = options;

  const [ranked, arena, aram] = await Promise.all([
    calculatePairingStats({
      players,
      startDate,
      endDate,
      serverId,
      gameMode: "ranked",
    }),
    calculatePairingStats({
      players,
      startDate,
      endDate,
      serverId,
      gameMode: "arena",
    }),
    calculatePairingStats({
      players,
      startDate,
      endDate,
      serverId,
      gameMode: "aram",
    }),
  ]);

  return { ranked, arena, aram };
}
