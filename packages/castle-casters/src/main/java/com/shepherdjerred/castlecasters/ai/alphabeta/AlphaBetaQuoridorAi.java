package com.shepherdjerred.castlecasters.ai.alphabeta;

import com.github.bentorfs.ai.search.minimax.MiniMaxAlgorithm;
import com.shepherdjerred.castlecasters.ai.QuoridorAi;
import com.shepherdjerred.castlecasters.ai.evaluator.MatchEvaluator;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class AlphaBetaQuoridorAi implements QuoridorAi {

  private final MatchEvaluator matchEvaluator;
  private final int depth;

  @Override
  public Turn calculateBestTurn(Match match) {
    var current = new QuoridorNode(match.getActivePlayerId(), match, null, matchEvaluator);
    var bestNode = (QuoridorNode) new MiniMaxAlgorithm(depth).getBestMove(current);
    return bestNode.turn();
  }
}
