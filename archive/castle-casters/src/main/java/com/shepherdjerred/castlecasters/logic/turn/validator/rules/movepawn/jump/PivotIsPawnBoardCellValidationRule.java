package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class PivotIsPawnBoardCellValidationRule implements ValidatorRule<JumpPawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnTurn turn) {
    var pivot = turn.pivot();

    if (match.board().isCoordinateInvalid(pivot)) {
      return new TurnValidationResult(true);
    }

    if (match.board().isPawnBoardCell(pivot)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.PIVOT_CELL_TYPE_NOT_PAWN);
    }
  }
}
