package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.straight;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnStraightTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class StraightPivotIsValidValidatorRule implements ValidatorRule<JumpPawnStraightTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnStraightTurn turn) {
    var src = turn.source();
    var dest = turn.destination();
    var pivot = turn.pivot();

    if (Coordinate.calculateManhattanDistance(src, pivot) == 2
        && Coordinate.calculateManhattanDistance(pivot, dest) == 2
        && Coordinate.areCoordinatesCardinal(src, pivot)
        && Coordinate.areCoordinatesCardinal(pivot, dest)
        && Coordinate.areCoordinatesCardinal(src, dest)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.PIVOT_NOT_VALID);
    }
  }
}
