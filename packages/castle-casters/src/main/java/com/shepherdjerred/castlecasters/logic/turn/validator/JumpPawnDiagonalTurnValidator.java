package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnDiagonalTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.diagonal.DiagonalPivotIsValidValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.diagonal.MoveIsDiagonalValidatorRule;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump.diagonal.WallIsBehindPivotValidatorRule;

import java.util.HashSet;
import java.util.Set;

public class JumpPawnDiagonalTurnValidator implements TurnValidator<JumpPawnDiagonalTurn> {

  private final Set<ValidatorRule<JumpPawnDiagonalTurn>> rules;

  public JumpPawnDiagonalTurnValidator() {
    rules = new HashSet<>();
    rules.add(new DiagonalPivotIsValidValidatorRule());
    rules.add(new MoveIsDiagonalValidatorRule());
    rules.add(new WallIsBehindPivotValidatorRule());
  }

  @Override
  public TurnValidationResult validate(Match match, JumpPawnDiagonalTurn turn) {
    var movePawnValidator = new MovePawnTurnValidator();
    var jumpPawnValidator = new JumpPawnTurnValidator();

    var movePawnResult = movePawnValidator.validate(match, turn);
    var jumpPawnResult = jumpPawnValidator.validate(match, turn);
    var result = new TurnValidationResult();
    for (ValidatorRule<JumpPawnDiagonalTurn> rule : rules) {
      var ruleResult = rule.validate(match, turn);
      result = TurnValidationResult.combine(result, ruleResult);
    }

    return TurnValidationResult.combine(result,
        TurnValidationResult.combine(movePawnResult, jumpPawnResult));
  }
}
