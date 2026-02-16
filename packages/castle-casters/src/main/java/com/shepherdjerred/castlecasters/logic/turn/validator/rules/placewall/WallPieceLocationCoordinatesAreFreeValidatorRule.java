package com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallPieceLocationCoordinatesAreFreeValidatorRule implements ValidatorRule<PlaceWallTurn> {

  @Override
  public TurnValidationResult validate(Match match, PlaceWallTurn turn) {
    var board = match.board();
    var location = turn.location();
    var firstCoordinate = location.firstCoordinate();
    var secondCoordinate = location.secondCoordinate();

    if (board.isEmpty(firstCoordinate)
        && board.isEmpty(secondCoordinate)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.COORDINATES_NOT_EMPTY);
    }
  }
}
