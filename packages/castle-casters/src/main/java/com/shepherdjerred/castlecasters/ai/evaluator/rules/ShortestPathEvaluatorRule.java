package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.board.search.BoardSearch;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.PlayerGoals;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.AllArgsConstructor;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

@Log4j2
@ToString
@AllArgsConstructor
public class ShortestPathEvaluatorRule implements EvaluatorRule {

  private final BoardSearch boardSearch;
  private final PlayerGoals playerGoals;

  @Override
  public double evaluate(Match match, QuoridorPlayer player) {
    var maxDistance = match.board().getBoardSize() * 2;
    var goals = playerGoals.getGoalCoordinatesForPlayer(player,
        match.board().getGridSize());
//    log.info(new MatchFormatter().matchToString(match));
    return maxDistance - boardSearch.getShortestPathToAnyDestination(match.board(),
        match.board().getPawnLocation(player),
        goals);
  }
}
