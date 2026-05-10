import { applyTurn, canonicalTurnKey, generateValidTurns, type MatchState, type Turn } from "#src/domain/match/match.ts";
import { evaluateMatch, type EvaluatorWeights } from "#src/ai/evaluation/evaluator.ts";
import type { PlayerId } from "#src/domain/types.ts";

export type AiStats = {
  nodes: number;
  depth: number;
  score: number;
};

export type AiResult = {
  turn: Turn;
  stats: AiStats;
};

export function chooseAiTurn(match: MatchState, playerId: PlayerId = match.activePlayer, depth = 2, weights?: EvaluatorWeights): AiResult {
  const turns = generateValidTurns(match);
  if (turns.length === 0) {
    throw new Error("AI cannot choose a turn because there are no legal turns.");
  }

  let nodes = 0;
  const firstTurn = turns[0];
  if (firstTurn === undefined) {
    throw new Error("AI cannot choose a turn because there are no legal turns.");
  }
  let bestTurn = firstTurn;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const turn of turns) {
    const next = applyTurn(match, turn);
    const score = alphaBeta(next, playerId, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, false, weights, () => {
      nodes += 1;
    });
    if (score > bestScore || (score === bestScore && canonicalTurnKey(turn).localeCompare(canonicalTurnKey(bestTurn)) < 0)) {
      bestTurn = turn;
      bestScore = score;
    }
  }

  return {
    turn: bestTurn,
    stats: { nodes, depth, score: bestScore },
  };
}

function alphaBeta(
  match: MatchState,
  optimizingPlayer: PlayerId,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  weights: EvaluatorWeights | undefined,
  visit: () => void,
): number {
  visit();
  if (depth <= 0 || match.status.type === "victory") {
    return evaluateMatch(match, optimizingPlayer, weights);
  }

  const turns = generateValidTurns(match);
  if (turns.length === 0) {
    return evaluateMatch(match, optimizingPlayer, weights);
  }

  if (maximizing) {
    let value = Number.NEGATIVE_INFINITY;
    let currentAlpha = alpha;
    for (const turn of turns) {
      value = Math.max(value, alphaBeta(applyTurn(match, turn), optimizingPlayer, depth - 1, currentAlpha, beta, false, weights, visit));
      currentAlpha = Math.max(currentAlpha, value);
      if (value >= beta) {
        break;
      }
    }
    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  let currentBeta = beta;
  for (const turn of turns) {
    value = Math.min(value, alphaBeta(applyTurn(match, turn), optimizingPlayer, depth - 1, alpha, currentBeta, true, weights, visit));
    currentBeta = Math.min(currentBeta, value);
    if (value <= alpha) {
      break;
    }
  }
  return value;
}
