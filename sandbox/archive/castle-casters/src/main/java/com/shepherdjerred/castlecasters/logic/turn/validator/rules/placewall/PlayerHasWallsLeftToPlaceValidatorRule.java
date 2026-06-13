package com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.ValidatorRule;

public class PlayerHasWallsLeftToPlaceValidatorRule implements ValidatorRule<PlaceWallTurn> {

  @Override
  public TurnValidationResult validate(Match match, PlaceWallTurn turn) {
    var player = turn.causer();
    if (match.getWallsLeft(player) > 0) {
      return new TurnValidationResult();
    } else {
      return new TurnValidationResult(ErrorMessage.PLAYER_HAS_NO_WALLS);
    }
  }
}
