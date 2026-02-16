package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class PivotHasPawnAtCoordinateValidatorRule implements ValidatorRule<JumpPawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnTurn turn) {
    if (match.board().hasPiece(turn.pivot())) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.NO_PIECE_AT_PIVOT);
    }
  }
}
