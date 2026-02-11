package com.shepherdjerred.castlecasters.ai.evaluator;

import com.shepherdjerred.castlecasters.ai.evaluator.rules.*;
import com.shepherdjerred.castlecasters.logic.board.search.AStarBoardSearch;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.PlayerGoals;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.AllArgsConstructor;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.util.HashMap;
import java.util.Map;

@Log4j2
@ToString
@AllArgsConstructor
public class WeightedMatchEvaluator implements MatchEvaluator {

  private final EvaluatorWeights weights;

  @Override
  public double evaluateMatch(Match match, QuoridorPlayer optimizingPlayer) {
    Map<EvaluatorRule, Double> evaluators = new HashMap<>();
    evaluators.put(new ShortestPathEvaluatorRule(new AStarBoardSearch(), new PlayerGoals()),
        weights.shortestPathWeight());
    evaluators.put(new DefeatEvaluatorRule(), 1.0);
    evaluators.put(new AdjacentPawnsEvaluationRule(), weights.adjacentPawnsWeight());
    evaluators.put(new OpponentsShortestPathEvaluatorRule(new AStarBoardSearch(),
        new PlayerGoals()), weights.opponentsShortestPathWeight());
    evaluators.put(new RemainingWallsEvaluatorRule(), weights.remainingWallsWeight());
    evaluators.put(new VictoryEvaluatorRule(), 1.0);
    evaluators.put(new WallsNearbyEvaluationRule(), weights.wallsNearbyWeight());

    var matchScore = evaluators.entrySet().stream()
        .map(entry -> {
          var evaluator = entry.getKey();
          var weight = entry.getValue();
          var rawScore = evaluator.evaluate(match, optimizingPlayer);
          var weightedScore = rawScore * weight;
          return weightedScore;
        })
        .mapToDouble(Double::doubleValue)
        .sum();

    return matchScore;
  }

}
