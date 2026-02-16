package com.shepherdjerred.castlecasters.logic.turn.validator.rules;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;

public interface ValidatorRule<T extends Turn> {

  TurnValidationResult validate(Match match, T turn);
}
