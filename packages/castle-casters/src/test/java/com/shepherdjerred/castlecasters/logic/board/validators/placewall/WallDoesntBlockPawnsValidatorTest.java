package com.shepherdjerred.castlecasters.logic.board.validators.placewall;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.board.search.AStarBoardSearch;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.PlayerGoals;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall.WallDoesntBlockPawnsValidatorRule;
import lombok.extern.log4j.Log4j2;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.MockitoAnnotations;

@Log4j2
public class WallDoesntBlockPawnsValidatorTest {

  @Mock
  private Match match;

  @BeforeEach
  public void setup() throws Exception {
    MockitoAnnotations.openMocks(this).close();
  }

  @Test
  public void testValidator_returnError_whenPawnIsBlocked() {
    var boardSearch = new AStarBoardSearch();
    var goals = new PlayerGoals();
    var validator = new WallDoesntBlockPawnsValidatorRule(boardSearch, goals);
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var leftWall = new WallLocation(new Coordinate(7, 0),
        new Coordinate(7, 1),
        new Coordinate(7, 2));
    var rightWall = new WallLocation(new Coordinate(9, 0),
        new Coordinate(9, 1),
        new Coordinate(9, 2));
    var topWall = new WallLocation(new Coordinate(8, 3),
        new Coordinate(9, 3),
        new Coordinate(10, 3));
    board = board.placeWall(QuoridorPlayer.ONE, leftWall);
    board = board.placeWall(QuoridorPlayer.ONE, rightWall);
    var turn = new PlaceWallTurn(QuoridorPlayer.ONE, topWall);

    Mockito.when(match.board()).thenReturn(board);

    var actual = validator.validate(match, turn);

    Assertions.assertTrue(actual.isError());
    Assertions.assertTrue(actual.getErrors().contains(ErrorMessage.WALL_BLOCKS_PAWN_PATH));
  }
}
