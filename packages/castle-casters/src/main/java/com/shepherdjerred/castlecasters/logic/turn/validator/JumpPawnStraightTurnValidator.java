package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnStraightTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.straight.StraightPivotIsValidValidatorRule;

import java.util.HashSet;
import java.util.Set;

public class JumpPawnStraightTurnValidator implements TurnValidator<JumpPawnStraightTurn> {

  private final Set<ValidatorRule<JumpPawnStraightTurn>> rules;

  public JumpPawnStraightTurnValidator() {
    rules = new HashSet<>();
    rules.add(new StraightPivotIsValidValidatorRule());
  }

  @Override
  public TurnValidationResult validate(Match match, JumpPawnStraightTurn turn) {
    var movePawnValidator = new MovePawnTurnValidator();
    var jumpPawnValidator = new JumpPawnTurnValidator();

    var movePawnResult = movePawnValidator.validate(match, turn);
    var jumpPawnResult = jumpPawnValidator.validate(match, turn);
    var result = new TurnValidationResult();
    for (ValidatorRule<JumpPawnStraightTurn> rule : rules) {
      var ruleResult = rule.validate(match, turn);
      result = TurnValidationResult.combine(result, ruleResult);
    }

    return TurnValidationResult.combine(result,
        TurnValidationResult.combine(movePawnResult, jumpPawnResult));
  }

}
