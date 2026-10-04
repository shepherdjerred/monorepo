package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.diagonal;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnDiagonalTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class WallIsBehindPivotValidatorRule implements ValidatorRule<JumpPawnDiagonalTurn> {
  @Override
  public TurnValidationResult validate(Match match, JumpPawnDiagonalTurn turn) {
    var board = match.board();
    var source = turn.source();
    var pivot = turn.pivot();
    if (!board.isCoordinateValid(source) || !board.isCoordinateValid(pivot)
        || !board.isCoordinateValid(turn.destination()) || !source.isCardinalTo(pivot)
        || source.getManhattanDistanceTo(pivot) != 2) {
      return new TurnValidationResult(ErrorMessage.PIVOT_NOT_VALID);
    }
    int dx = pivot.x() - source.x(), dy = pivot.y() - source.y();
    var behindWall = new Coordinate(pivot.x() + dx / 2, pivot.y() + dy / 2);
    var landing = new Coordinate(pivot.x() + dx, pivot.y() + dy);
    if (!board.isCoordinateValid(landing) || board.hasWall(behindWall) || board.hasPiece(landing)) {
      return new TurnValidationResult();
    }
    return new TurnValidationResult(ErrorMessage.NO_WALL_BEHIND_PIVOT);
  }
}
