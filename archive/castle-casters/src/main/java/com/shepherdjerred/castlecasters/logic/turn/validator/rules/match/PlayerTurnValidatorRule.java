package com.shepherdjerred.castlecasters.logic.turn.validator.rules.match;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class PlayerTurnValidatorRule implements ValidatorRule<Turn> {

  @Override
  public TurnValidationResult validate(Match match, Turn turn) {
    if (turn.causer() == match.getActivePlayerId()) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.NOT_CAUSERS_TURN);
    }
  }
}
