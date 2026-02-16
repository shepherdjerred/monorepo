package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallIsBetweenPivotAndDestinationValidatorRule implements
    ValidatorRule<JumpPawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnTurn turn) {
    var pivot = turn.pivot();
    var dest = turn.destination();
    var dist = Coordinate.calculateManhattanDistance(pivot, dest);

    // If the distance != 2 then we can't do this check
    if (dist != 2) {
      return new TurnValidationResult(ErrorMessage.NULL);
    }

    var coordinateBetween = Coordinate.calculateMidpoint(pivot, dest);
    if (match.board().hasPiece(coordinateBetween)) {
      return new TurnValidationResult(ErrorMessage.WALL_BETWEEN_PIVOT_AND_DESTINATION);
    } else {
      return new TurnValidationResult();
    }
  }
}
