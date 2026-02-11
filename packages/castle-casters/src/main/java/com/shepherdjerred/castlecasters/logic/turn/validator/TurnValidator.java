package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public interface TurnValidator<T extends Turn> {

  TurnValidationResult validate(Match match, T turn);
}
