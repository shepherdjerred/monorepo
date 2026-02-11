package com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallPieceLocationVertexIsVertexBoardCellValidatorRule implements ValidatorRule<PlaceWallTurn> {

  @Override
  public TurnValidationResult validate(Match match, PlaceWallTurn turn) {
    var location = turn.location();
    var vertex = location.vertex();
    var board = match.board();
    if (board.isWallVertexBoardCell(vertex)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.VERTEX_COORDINATE_IS_NOT_VERTEX_CELL);
    }
  }
}
