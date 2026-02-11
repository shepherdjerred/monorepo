package com.shepherdjerred.castlecasters.logic.turn.validator.rules.movepawn;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.MovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;
import lombok.ToString;

@ToString
public class DestinationBoardCellTypeIsPawnValidatorRule implements ValidatorRule<MovePawnTurn> {

  @Override
  public TurnValidationResult validate(Match match, MovePawnTurn turn) {
    var destination = turn.destination();

    if (match.board().isCoordinateInvalid(destination)) {
      return new TurnValidationResult(true);
    }

    if (match.board().isPawnBoardCell(destination)) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.DESTINATION_CELL_TYPE_NOT_PAWN);
    }
  }
}
