package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.match.MatchStatusValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.match.PlayerTurnValidatorRule;

import java.util.HashSet;
import java.util.Set;

public class MatchTurnValidator implements TurnValidator<Turn> {

  private final Set<ValidatorRule<Turn>> rules;

  public MatchTurnValidator() {
    rules = new HashSet<>();
    rules.add(new MatchStatusValidatorRule());
    rules.add(new PlayerTurnValidatorRule());
  }

  @Override
  public TurnValidationResult validate(Match match, Turn turn) {
    var result = new TurnValidationResult();
    for (ValidatorRule<Turn> rule : rules) {
      var ruleResult = rule.validate(match, turn);
      result = TurnValidationResult.combine(result, ruleResult);
    }
    return result;
  }
}
