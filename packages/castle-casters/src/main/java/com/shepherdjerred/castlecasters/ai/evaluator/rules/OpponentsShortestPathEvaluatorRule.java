package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.board.search.BoardSearch;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.PlayerGoals;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.AllArgsConstructor;
import lombok.ToString;

import java.util.HashSet;
import java.util.Set;

@ToString
@AllArgsConstructor
public class OpponentsShortestPathEvaluatorRule implements EvaluatorRule {

  private final BoardSearch boardSearch;
  private final PlayerGoals playerGoals;

  @Override
  public double evaluate(Match match, QuoridorPlayer player) {
    var playerCount = match.matchSettings().playerCount();
    Set<QuoridorPlayer> players = new HashSet<>();

    if (playerCount == PlayerCount.TWO) {
      players.add(QuoridorPlayer.ONE);
      players.add(QuoridorPlayer.TWO);
    } else if (playerCount == PlayerCount.FOUR) {
      players.add(QuoridorPlayer.ONE);
      players.add(QuoridorPlayer.TWO);
      players.add(QuoridorPlayer.THREE);
      players.add(QuoridorPlayer.FOUR);
    } else {
      throw new UnsupportedOperationException();
    }

    players.remove(player);

    var sumOfDistances = players.stream()
        .map(p -> {
          var gridSize = match.board().getGridSize();
          var goals = playerGoals.getGoalCoordinatesForPlayer(p,
              gridSize);
          return boardSearch.getShortestPathToAnyDestination(match.board(),
              match.board().getPawnLocation(p),
              goals);
        })
        .mapToInt(Integer::intValue)
        .sum();

    return Math.pow(sumOfDistances, 2);
  }
}
