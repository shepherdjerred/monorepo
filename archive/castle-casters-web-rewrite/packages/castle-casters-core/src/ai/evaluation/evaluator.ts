import { activePlayers, type PlayerId } from "#src/domain/types.ts";
import {
  adjacentPawnSpaces,
  hasPawnAt,
  hasWallAt,
  isInBounds,
  shortestPath,
  type MatchState,
} from "#src/domain/match/match.ts";
import { coordinate } from "#src/domain/board/coordinate.ts";

export const maxEvaluatorScore = 1_000_000;
export const minEvaluatorScore = -1_000_000;

export type EvaluatorWeights = {
  adjacentPawns: number;
  opponentsShortestPath: number;
  remainingWalls: number;
  shortestPath: number;
  wallsNearby: number;
};

export const defaultEvaluatorWeights: EvaluatorWeights = {
  adjacentPawns: 9612.407_041_694_314,
  opponentsShortestPath: -7288.691_596_308_785,
  remainingWalls: 9786.056_427_421_212,
  shortestPath: 2396.699_154_793_13,
  wallsNearby: 476.913_030_383_469_96,
};

export function evaluateMatch(match: MatchState, optimizingPlayer: PlayerId, weights: EvaluatorWeights = defaultEvaluatorWeights): number {
  return (
    evaluateShortestPath(match, optimizingPlayer) * weights.shortestPath +
    evaluateDefeat(match, optimizingPlayer) +
    evaluateAdjacentPawns(match, optimizingPlayer) * weights.adjacentPawns +
    evaluateOpponentsShortestPath(match, optimizingPlayer) * weights.opponentsShortestPath +
    evaluateRemainingWalls(match, optimizingPlayer) * weights.remainingWalls +
    evaluateVictory(match, optimizingPlayer) +
    evaluateWallsNearby(match, optimizingPlayer) * weights.wallsNearby
  );
}

export function evaluateVictory(match: MatchState, playerId: PlayerId): number {
  return match.status.type === "victory" && match.status.winner === playerId ? maxEvaluatorScore : 0;
}

export function evaluateDefeat(match: MatchState, playerId: PlayerId): number {
  return match.status.type === "victory" && match.status.winner !== playerId ? minEvaluatorScore : 0;
}

export function evaluateShortestPath(match: MatchState, playerId: PlayerId): number {
  return match.settings.boardSize * 2 - (shortestPath(match, playerId) ?? 0);
}

export function evaluateOpponentsShortestPath(match: MatchState, playerId: PlayerId): number {
  const sumOfDistances = activePlayers(match.settings.playerCount)
    .filter((opponentId) => opponentId !== playerId)
    .map((opponentId) => shortestPath(match, opponentId) ?? 999)
    .reduce((total, distance) => total + distance, 0);
  return Math.pow(sumOfDistances, 2);
}

export function evaluateRemainingWalls(match: MatchState, playerId: PlayerId): number {
  return match.wallsRemaining[playerId] ?? 0;
}

export function evaluateAdjacentPawns(match: MatchState, playerId: PlayerId): number {
  return adjacentPawnSpaces(match, match.pawns[playerId] ?? coordinate(-1, -1)).filter((space) => hasPawnAt(match, space)).length;
}

export function evaluateWallsNearby(match: MatchState, playerId: PlayerId): number {
  const pawn = match.pawns[playerId];
  if (pawn === undefined) {
    return 0;
  }
  return [
    coordinate(pawn.x - 1, pawn.y),
    coordinate(pawn.x + 1, pawn.y),
    coordinate(pawn.x, pawn.y - 1),
    coordinate(pawn.x, pawn.y + 1),
  ].filter((space) => isInBounds(match, space) && hasWallAt(match, space)).length;
}
