package com.shepherdjerred.castlecasters.ai.alphabeta.pruning;

import com.github.bentorfs.ai.search.minimax.MiniMaxAlgorithm;
import com.shepherdjerred.castlecasters.ai.QuoridorAi;
import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules.NodePruningRule;
import com.shepherdjerred.castlecasters.ai.evaluator.MatchEvaluator;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Set;

@Log4j2
@AllArgsConstructor
public class PruningAlphaBetaQuoridorAi implements QuoridorAi {

  private final MatchEvaluator matchEvaluator;
  private final int maxDepth;
  private final Set<NodePruningRule> nodePruningRules;

  @Override
  public Turn calculateBestTurn(Match match) {
    var current = new PruningQuoridorNode(match.getActivePlayerId(),
        match,
        null,
        matchEvaluator,
        nodePruningRules,
        0,
        0);
    var bestNode = (PruningQuoridorNode) new MiniMaxAlgorithm(maxDepth).getBestMove(current);
    return bestNode.getTurn();
  }
}
