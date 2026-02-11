import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";
import { queryMatchesByDateRange } from "@shepherdjerred/scout-backend/storage/s3-query.ts";
import {
  type RawMatch,
  parseQueueType,
  findParticipant,
  MIN_GAME_DURATION_SECONDS,
  type PairingStatsEntry,
  type IndividualPlayerStats,
  type ServerPairingStats,
  type QueueType,
} from "@shepherdjerred/scout-data/index";
import type { ServerPlayer } from "./get-server-players.ts";
import { createPuuidToAliasMap } from "./get-server-players.ts";

/**
 * Supported game mode categories for pairing stats
 */
export type GameModeCategory = "ranked" | "arena" | "aram";

/**
 * Get the queue types that belong to a game mode category
 */
function getQueueTypesForCategory(category: GameModeCategory): QueueType[] {
  switch (category) {
    case "ranked":
      return ["solo", "flex"];
    case "arena":
      return ["arena"];
    case "aram":
      return ["aram"];
  }
}

const logger = createLogger("pairing-calculate");

/**
 * Internal structure for accumulating pairing stats during calculation
 */
type PairingAccumulator = {
  wins: number;
  losses: number;
  surrenders: number;
};

/**
 * Get all combinations of elements from an array
 * For [A, B, C] returns [[A], [B], [C], [A,B], [A,C], [B,C], [A,B,C]]
 */
function getAllCombinations<T>(arr: T[]): T[][] {
  const result: T[][] = [];

  function backtrack(start: number, current: T[]): void {
    if (current.length > 0) {
      result.push([...current]);
    }
    for (let i = start; i < arr.length; i++) {
      const element = arr[i];
      if (element !== undefined) {
        current.push(element);
        backtrack(i + 1, current);
        current.pop();
      }
    }
  }

  backtrack(0, []);
  return result;
}

/**
 * Create a canonical key for a pairing (sorted aliases joined by comma)
 */
function createPairingKey(aliases: string[]): string {
  return [...aliases].sort().join(",");
}

/**
 * Options for calculating pairing stats
 */
export type CalculatePairingStatsOptions = {
  players: ServerPlayer[];
  startDate: Date;
  endDate: Date;
  serverId: string;
  gameMode?: GameModeCategory;
};

/**
 * Calculate pairing stats from matches
 */
export async function calculatePairingStats(options: CalculatePairingStatsOptions): Promise<ServerPairingStats> {
  const { players, startDate, endDate, serverId, gameMode = "ranked" } = options;
  const allowedQueueTypes = getQueueTypesForCategory(gameMode);
  logger.info(
    `[CalculatePairings] Starting calculation for ${players.length.toString()} players (${gameMode}: ${allowedQueueTypes.join(", ")})`,
  );
  logger.info(`[CalculatePairings] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Create PUUID to alias map
  const puuidToAlias = createPuuidToAliasMap(players);
  const allPuuids = Array.from(puuidToAlias.keys());

  if (allPuuids.length === 0) {
    logger.warn("[CalculatePairings] No PUUIDs found, returning empty stats");
    return createEmptyStats(serverId, startDate, endDate);
  }

  // Query matches from S3
  logger.info(`[CalculatePairings] Querying matches for ${allPuuids.length.toString()} PUUIDs`);
  const matches = await queryMatchesByDateRange(startDate, endDate, allPuuids);
  logger.info(`[CalculatePairings] Found ${matches.length.toString()} matches total`);

  // Filter and process matches
  const pairingAccumulators = new Map<string, PairingAccumulator>();
  let totalMatchesFiltered = 0;
  let totalMatchesAnalyzed = 0;

  for (const match of matches) {
    const result = processMatch(match, puuidToAlias, pairingAccumulators, allowedQueueTypes);
    if (result.filtered) {
      totalMatchesFiltered++;
      logger.debug(`[CalculatePairings] Filtered match ${match.metadata.matchId}: ${result.reason ?? "unknown"}`);
    } else {
      totalMatchesAnalyzed++;
    }
  }

  logger.info(
    `[CalculatePairings] Analyzed ${totalMatchesAnalyzed.toString()} matches, filtered ${totalMatchesFiltered.toString()}`,
  );

  // Convert accumulators to stats entries
  const pairings: PairingStatsEntry[] = [];
  const individualStats: IndividualPlayerStats[] = [];

  for (const [key, acc] of pairingAccumulators.entries()) {
    const playerAliases = key.split(",");
    const totalGames = acc.wins + acc.losses;
    const winRate = totalGames > 0 ? acc.wins / totalGames : 0;

    const entry: PairingStatsEntry = {
      players: playerAliases,
      wins: acc.wins,
      losses: acc.losses,
      surrenders: acc.surrenders,
      totalGames,
      winRate,
    };

    if (playerAliases.length === 1) {
      const alias = playerAliases[0];
      if (alias !== undefined) {
        // Individual stats for this player (includes all their games, not just solo)
        individualStats.push({
          alias,
          wins: acc.wins,
          losses: acc.losses,
          surrenders: acc.surrenders,
          totalGames,
        });
      }
    } else {
      pairings.push(entry);
    }
  }

  // Log top/bottom pairings for debugging
  const sortedPairings = [...pairings].sort((a, b) => b.winRate - a.winRate);
  const top = sortedPairings[0];
  const bottom = sortedPairings[sortedPairings.length - 1];
  if (top !== undefined && bottom !== undefined) {
    logger.info(
      `[CalculatePairings] Highest win rate: ${top.players.join(" + ")} = ${(top.winRate * 100).toFixed(1)}% (${top.totalGames.toString()} games)`,
    );
    logger.info(
      `[CalculatePairings] Lowest win rate: ${bottom.players.join(" + ")} = ${(bottom.winRate * 100).toFixed(1)}% (${bottom.totalGames.toString()} games)`,
    );
  }

  // Log individual surrender stats
  const sortedBySurrenders = [...individualStats].sort((a, b) => b.surrenders - a.surrenders);
  const topSurrenderer = sortedBySurrenders[0];
  if (topSurrenderer !== undefined && topSurrenderer.surrenders > 0) {
    logger.info(
      `[CalculatePairings] Most surrenders: ${topSurrenderer.alias} = ${topSurrenderer.surrenders.toString()} surrenders`,
    );
  }

  return {
    version: "v1",
    serverId,
    periodStart: startDate.toISOString(),
    periodEnd: endDate.toISOString(),
    calculatedAt: new Date().toISOString(),
    individualStats,
    pairings,
    totalMatchesAnalyzed,
    totalMatchesFiltered,
  };
}

/**
 * Process a single match and update pairing accumulators
 */
function processMatch(
  match: RawMatch,
  puuidToAlias: Map<string, string>,
  accumulators: Map<string, PairingAccumulator>,
  allowedQueueTypes: QueueType[],
): { filtered: boolean; reason?: string } {
  // Check game duration (15+ minutes)
  if (match.info.gameDuration < MIN_GAME_DURATION_SECONDS) {
    return {
      filtered: true,
      reason: `duration ${match.info.gameDuration.toString()}s < ${MIN_GAME_DURATION_SECONDS.toString()}s`,
    };
  }

  // Check queue type against allowed types
  const queueType = parseQueueType(match.info.queueId);
  if (!queueType || !allowedQueueTypes.includes(queueType)) {
    return { filtered: true, reason: `queue type ${queueType ?? "unknown"} not in ${allowedQueueTypes.join("/")}` };
  }

  // Find tracked players in this match
  const trackedPlayersInMatch: { alias: string; won: boolean; surrendered: boolean }[] = [];

  for (const puuid of match.metadata.participants) {
    const alias = puuidToAlias.get(puuid);
    if (alias) {
      const participant = findParticipant(puuid, match.info.participants);
      if (participant) {
        trackedPlayersInMatch.push({
          alias,
          won: participant.win,
          // Only track surrenders for losses (not wins where enemy surrendered)
          surrendered: participant.gameEndedInSurrender && !participant.win,
        });
      }
    }
  }

  if (trackedPlayersInMatch.length === 0) {
    return { filtered: true, reason: "no tracked players found" };
  }

  // Get unique aliases (a player might have multiple accounts, but we want unique)
  const uniqueAliases = [...new Set(trackedPlayersInMatch.map((p) => p.alias))];

  // Determine match outcome for tracked players
  // All tracked players should have the same outcome if they're on the same team
  // If they're on different teams, we need to track each combination separately
  const aliasToOutcome = new Map<string, { won: boolean; surrendered: boolean }>();
  for (const player of trackedPlayersInMatch) {
    const existing = aliasToOutcome.get(player.alias);
    if (existing) {
      // Validate that all accounts for the same player have the same outcome
      if (existing.won !== player.won) {
        // Player has multiple accounts with conflicting outcomes (likely custom game)
        return { filtered: true, reason: `player ${player.alias} has conflicting outcomes` };
      }
    } else {
      aliasToOutcome.set(player.alias, { won: player.won, surrendered: player.surrendered });
    }
  }

  // Generate all combinations of tracked players
  const combinations = getAllCombinations(uniqueAliases);

  for (const combo of combinations) {
    const key = createPairingKey(combo);

    // For a combination, check if all players have the same outcome
    // If players are on different teams, we skip this combination for win/loss tracking
    const outcomes = combo.map((alias) => aliasToOutcome.get(alias));
    const firstOutcome = outcomes[0];
    if (firstOutcome === undefined) {
      continue;
    }
    const allSameOutcome = outcomes.every((o) => o !== undefined && o.won === firstOutcome.won);

    if (!allSameOutcome) {
      // Players on different teams - skip this match for this combination
      continue;
    }

    const won = firstOutcome.won;
    const surrendered = outcomes.some((o) => o?.surrendered === true);

    // Update accumulator
    let acc = accumulators.get(key);
    if (!acc) {
      acc = { wins: 0, losses: 0, surrenders: 0 };
      accumulators.set(key, acc);
    }

    if (won) {
      acc.wins++;
    } else {
      acc.losses++;
      if (surrendered) {
        acc.surrenders++;
      }
    }
  }

  logger.debug(
    `[CalculatePairings] Processed match ${match.metadata.matchId}: ${uniqueAliases.join(", ")} (${queueType})`,
  );
  return { filtered: false };
}

/**
 * Create empty stats structure
 */
function createEmptyStats(serverId: string, startDate: Date, endDate: Date): ServerPairingStats {
  return {
    version: "v1",
    serverId,
    periodStart: startDate.toISOString(),
    periodEnd: endDate.toISOString(),
    calculatedAt: new Date().toISOString(),
    individualStats: [],
    pairings: [],
    totalMatchesAnalyzed: 0,
    totalMatchesFiltered: 0,
  };
}
