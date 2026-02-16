package com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallPieceLocationVertexIsFreeValidatorRule implements ValidatorRule<PlaceWallTurn> {

  @Override
  public TurnValidationResult validate(Match match, PlaceWallTurn turn) {
    var wallLocation = turn.location();
    var vertex = wallLocation.vertex();
    var board = match.board();

    if (board.isCoordinateInvalid(vertex)) {
      return new TurnValidationResult(ErrorMessage.VALIDATOR_FAILED);
    }

    if (board.hasWall(vertex)) {
      return new TurnValidationResult(ErrorMessage.VERTEX_NOT_FREE);
    } else {
      return new TurnValidationResult();
    }
  }
}
