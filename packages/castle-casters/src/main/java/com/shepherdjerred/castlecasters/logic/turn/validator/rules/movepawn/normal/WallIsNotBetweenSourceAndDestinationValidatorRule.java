package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.normal;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import lombok.ToString;

@ToString
public class WallIsNotBetweenSourceAndDestinationValidatorRule implements ValidatorRule<NormalMovePawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, NormalMovePawnTurn turn) {
    var dist = Coordinate.calculateManhattanDistance(turn.source(), turn.destination());

    // If the distance != 2 then we can't do this check
    if (dist != 2) {
      return new TurnValidationResult(ErrorMessage.COULD_NOT_RUN_VALIDATOR);
    }

    var coordinateBetween = Coordinate.calculateMidpoint(turn.source(), turn.destination());
    if (match.board().hasPiece(coordinateBetween)) {
      return new TurnValidationResult(ErrorMessage.WALL_BETWEEN_SOURCE_AND_DESTINATION);
    } else {
      return new TurnValidationResult();
    }
  }
}
