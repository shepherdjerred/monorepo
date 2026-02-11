package com.shepherdjerred.castlecasters.ai.genetic;

import com.google.common.collect.ImmutableSet;
import com.shepherdjerred.castlecasters.ai.IdealWeights;
import com.shepherdjerred.castlecasters.ai.QuoridorAi;
import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.PruningAlphaBetaQuoridorAi;
import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules.PieceDistanceNodePruningRule;
import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules.RandomDiscardNodePruningRule;
import com.shepherdjerred.castlecasters.ai.evaluator.EvaluatorWeights;
import com.shepherdjerred.castlecasters.ai.evaluator.WeightedMatchEvaluator;
import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.match.MatchStatus.Status;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import io.jenetics.DoubleChromosome;
import io.jenetics.DoubleGene;
import io.jenetics.Genotype;
import io.jenetics.engine.Codec;
import io.jenetics.engine.Problem;
import io.jenetics.util.DoubleRange;
import lombok.extern.log4j.Log4j2;

import java.util.function.Function;

@Log4j2
public class WeightsProblem implements Problem<EvaluatorWeights, DoubleGene, Integer> {
  @Override
  public Function<EvaluatorWeights, Integer> fitness() {
    return weights -> {
      var boardSettings = new BoardSettings(9, PlayerCount.TWO);
      var matchSettings = new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO);
      var match = Match.from(matchSettings, boardSettings);

      // this is the evaluator that we are trying to optimize
      var weightedEvaluator = new WeightedMatchEvaluator(weights);
      // this is the evaluator with the best weights that we have found so far
      var bestKnownEvaluator = new WeightedMatchEvaluator(IdealWeights.getIdealWeights());

      var pruningRules = ImmutableSet.of(
          new RandomDiscardNodePruningRule(60),
          new PieceDistanceNodePruningRule(3));

      var alphaBetaAi = new PruningAlphaBetaQuoridorAi(weightedEvaluator, 2, pruningRules);
      var randomAi = new PruningAlphaBetaQuoridorAi(bestKnownEvaluator, 2, pruningRules);

      return simulateAi(match, alphaBetaAi, randomAi);
    };
  }

  @Override
  public Codec<EvaluatorWeights, DoubleGene> codec() {
    return Codec.of(
        Genotype.of(DoubleChromosome.of(DoubleRange.of(-10000, 10000), 5)),
        gt -> new EvaluatorWeights(gt.get(0, 0).doubleValue(),
            gt.get(0, 1).doubleValue(),
            gt.get(0, 2).doubleValue(),
            gt.get(0, 3).doubleValue(),
            gt.get(0, 4).doubleValue())
    );
  }

  private int simulateAi(Match match, QuoridorAi playerOne, QuoridorAi playerTwo) {
//    log.info("Simulating AI match");

    int currentTurn = 1;
    while (match.matchStatus().status() == Status.IN_PROGRESS) {
      Turn aiTurn;
      if (match.getActivePlayerId() == QuoridorPlayer.ONE) {
        aiTurn = playerOne.calculateBestTurn(match);
      } else {
        aiTurn = playerTwo.calculateBestTurn(match);
      }

      match = match.doTurn(aiTurn);

      currentTurn++;

      if (currentTurn > 200) {
        return Integer.MIN_VALUE;
      }

      if (currentTurn < 10) {
//        log.info("TURN 1: {}", currentTurn);
      } else if (currentTurn % 10 == 0 && currentTurn < 100) {
//        log.info("TURN2 : {}", currentTurn);
      } else if (currentTurn % 50 == 0) {
//        log.info("TURN 3: {}", currentTurn);
      }
    }

//    log.info(match.matchStatus().victor());

    if (match.matchStatus().victor() == QuoridorPlayer.ONE) {
      return currentTurn * -1;
    } else {
      return Integer.MIN_VALUE;
    }
  }
}
