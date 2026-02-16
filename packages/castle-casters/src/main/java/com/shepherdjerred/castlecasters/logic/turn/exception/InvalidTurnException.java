package com.shepherdjerred.castlecasters.logic.turn.exception;

import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;

public class InvalidTurnException extends RuntimeException {

  public InvalidTurnException(Turn turn) {
    super(turn.toString());
  }

  public InvalidTurnException(Turn turn, TurnValidationResult TurnValidationResult) {
    super(turn.toString() + " " + TurnValidationResult.toString());
  }

}
