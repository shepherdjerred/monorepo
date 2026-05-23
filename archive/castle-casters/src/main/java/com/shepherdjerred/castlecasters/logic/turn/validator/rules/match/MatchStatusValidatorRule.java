package com.shepherdjerred.castlecasters.logic.turn.validator.rules.match;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchStatus.Status;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class MatchStatusValidatorRule implements ValidatorRule<Turn> {

  @Override
  public TurnValidationResult validate(Match match, Turn turn) {
    if (match.matchStatus().status() == Status.IN_PROGRESS) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.MATCH_ALREADY_OVER);
    }
  }
}
