package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.shepherdjerred.castlecasters.logic.turn.*;
import lombok.EqualsAndHashCode;

@EqualsAndHashCode
public class TurnValidatorFactory {

  public <T extends Turn> TurnValidator<T> getValidator(T turn) {
    TurnValidator<?> validator = switch (turn) {
      case PlaceWallTurn ignored -> new PlaceWallTurnValidator();
      case NormalMovePawnTurn ignored -> new NormalMovePawnTurnValidator();
      case JumpPawnStraightTurn ignored -> new JumpPawnStraightTurnValidator();
      case JumpPawnDiagonalTurn ignored -> new JumpPawnDiagonalTurnValidator();
      case null, default -> throw new UnsupportedOperationException();
    };

    //noinspection unchecked
    return (TurnValidator<T>) validator;
  }
}
