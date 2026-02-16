package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn.jump;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.JumpPawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class DestinationIsTwoPawnSpacesAwayValidatorRule implements ValidatorRule<JumpPawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, JumpPawnTurn turn) {
    var dist = Coordinate.calculateManhattanDistance(turn.source(), turn.destination());

    // We check if the distance equals four because wall cells count in the calculation
    if (dist == 4) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.MOVE_NOT_TWO_SPACES_AWAY);
    }
  }
}
