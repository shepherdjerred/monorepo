package com.shepherdjerred.castlecasters.logic.turn.enactor;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchHistoryEntry;
import com.shepherdjerred.castlecasters.logic.match.MatchStatusUpdater;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.Turn;
import com.shepherdjerred.castlecasters.logic.turn.exception.InvalidTurnException;
import com.shepherdjerred.castlecasters.logic.turn.validator.MatchTurnValidator;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;

// TODO this needs to be cleaned up
@EqualsAndHashCode
@AllArgsConstructor
public class MatchTurnEnactor {

  private final TurnEnactorFactory turnEnactorFactory;
  private final TurnValidatorFactory turnValidatorFactory;
  private final MatchStatusUpdater matchStatusUpdater;

  public Match enactTurn(Turn turn, Match match) {
    var matchValidatorResult = new MatchTurnValidator().validate(match, turn);
    if (matchValidatorResult.isError()) {
      throw new InvalidTurnException(turn, matchValidatorResult);
    }

    var validator = turnValidatorFactory.getValidator(turn);
    var validatorResult = validator.validate(match, turn);
    if (validatorResult.isError()) {
      throw new InvalidTurnException(turn, validatorResult);
    } else {
      return enactTurnUnchecked(turn, match);
    }
  }

  public Match enactTurnUnchecked(Turn turn, Match match) {
    var enactor = turnEnactorFactory.getEnactor(turn);
    var board = match.board();

    var newBoard = enactor.enactTurn(turn, board);
    var newMatchStatus = matchStatusUpdater.updateMatchStatus(turn, match);

    // TODO I think this would be better to do in the turn specific handler, but I'm not sure how that can be done well
    var newWallPool = match.wallBank();
    if (turn instanceof PlaceWallTurn) {
      newWallPool = newWallPool.takeWall(turn.causer());
    }

    var matchHistory = match.matchHistory();
    var newHistory = matchHistory.push(new MatchHistoryEntry(match, turn));

    var matchSettings = match.matchSettings();

    var newActivePlayerTracker = match.activePlayerTracker().getNextActivePlayerTracker();

    return new Match(newBoard,
        matchSettings,
        newWallPool,
        newMatchStatus,
        newHistory,
        match.matchTurnEnactor(),
        newActivePlayerTracker);
  }
}
