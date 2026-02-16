package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallIsBetweenPivotAndSourceValidatorRule implements ValidatorRule<JumpPawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnTurn turn) {
    var pivot = turn.pivot();
    var src = turn.source();
    var dist = Coordinate.calculateManhattanDistance(pivot, src);

    // If the distance != 2 then we can't do this check
    if (dist != 2) {
      return new TurnValidationResult(ErrorMessage.COULD_NOT_RUN_VALIDATOR);
    }

    var coordinateBetween = Coordinate.calculateMidpoint(pivot, src);
    if (match.board().hasPiece(coordinateBetween)) {
      return new TurnValidationResult(ErrorMessage.WALL_BETWEEN_PIVOT_AND_SOURCE);
    } else {
      return new TurnValidationResult();
    }
  }
}
