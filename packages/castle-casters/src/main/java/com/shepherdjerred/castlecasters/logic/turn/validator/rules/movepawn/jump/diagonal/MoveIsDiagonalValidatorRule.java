package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.diagonal;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnDiagonalTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import lombok.ToString;

@ToString
public class MoveIsDiagonalValidatorRule implements ValidatorRule<JumpPawnDiagonalTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnDiagonalTurn turn) {
    var source = turn.source();
    var destination = turn.destination();
    if (Coordinate.areCoordinatesDiagonal(source, destination)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.MOVE_NOT_DIAGONAL);
    }
  }
}
