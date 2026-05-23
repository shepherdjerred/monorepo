package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.MovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import lombok.ToString;

@ToString
public class TurnSourceIsSameAsActualLocationValidatorRule implements ValidatorRule<MovePawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, MovePawnTurn turn) {
    if (turn.source().equals(match.board().getPawnLocation(turn.causer()))) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.SOURCE_DIFFERENT_FROM_ACTUAL_LOCATION);
    }
  }
}
