package com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallPieceLocationCoordinatesAreValidValidatorRule implements ValidatorRule<PlaceWallTurn> {

  @Override
  public TurnValidationResult validate(Match match, PlaceWallTurn turn) {
    var location = turn.location();
    var c1 = location.firstCoordinate();
    var vertex = location.vertex();
    var c2 = location.secondCoordinate();
    var board = match.board();
    if (board.isCoordinateInvalid(c1)
        || board.isCoordinateInvalid(vertex)
        || board.isCoordinateInvalid(c2)) {
      return new TurnValidationResult(ErrorMessage.COORDINATES_INVALID);
    } else {
      return new TurnValidationResult();
    }
  }
}
