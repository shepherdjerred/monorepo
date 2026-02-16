package com.shepherdjerred.castlecasters.logic.match;

import com.shepherdjerred.castlecasters.logic.match.MatchStatus.Status;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;

@EqualsAndHashCode
@AllArgsConstructor
public class MatchStatusUpdater {

  private final PlayerGoals playerGoals;

  public MatchStatus updateMatchStatus(Turn turn, Match match) {
    var player = turn.causer();
    if (turn instanceof NormalMovePawnTurn movePawnTurn) {
      var gridSize = match.board().getGridSize();
      var destination = movePawnTurn.destination();

      var goals = playerGoals.getGoalCoordinatesForPlayer(player, gridSize);
      if (goals.contains(destination)) {
        return new MatchStatus(player, Status.VICTORY);
      }
    }
    return match.matchStatus();
  }

  private boolean doesStalemateRuleApply(Match match) {
    var prev1 = match.matchHistory().pop().match();
    var prev2 = prev1.matchHistory().pop().match();
    var prev3 = prev2.matchHistory().pop().match();
    var prev4 = prev3.matchHistory().pop().match();
    var prev5 = prev4.matchHistory().pop().match();

    return match.equals(prev2) && prev2.equals(prev4) && prev1.equals(prev3) && prev3.equals(prev5);
  }
}
