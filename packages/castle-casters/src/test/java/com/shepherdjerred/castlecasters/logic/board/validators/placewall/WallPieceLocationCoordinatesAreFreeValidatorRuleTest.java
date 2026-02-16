package com.shepherdjerred.castlecasters.logic.board.validators.placewall;


import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidationResult.ErrorMessage;
import com.shepherdjerred.castlecasters.logic.turn.validator.rules.placewall.WallPieceLocationCoordinatesAreFreeValidatorRule;
import lombok.extern.log4j.Log4j2;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import static org.mockito.Mockito.when;

@Log4j2
public class WallPieceLocationCoordinatesAreFreeValidatorRuleTest {

  @Mock
  private Match match;

  @BeforeEach
  public void setup() throws Exception {
    MockitoAnnotations.openMocks(this).close();
  }

  @Test
  public void validate_returnsFalse_WhenACoordinateIsNotFree() {
    var validator = new WallPieceLocationCoordinatesAreFreeValidatorRule();
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));

    var wall = new WallLocation(new Coordinate(8, 1),
        new Coordinate(7, 1),
        new Coordinate(6, 1));
    var offsetWallOnLeft = new WallLocation(new Coordinate(6, 1),
        new Coordinate(5, 1),
        new Coordinate(4, 1));
    var offsetWallOnRight = new WallLocation(new Coordinate(8, 1),
        new Coordinate(9, 1),
        new Coordinate(10, 1));

    board = board.placeWall(QuoridorPlayer.ONE, wall);
    when(match.board()).thenReturn(board);

    var turnOne = new PlaceWallTurn(QuoridorPlayer.ONE, wall);
    var turnTwo = new PlaceWallTurn(QuoridorPlayer.ONE, offsetWallOnLeft);
    var turnThree = new PlaceWallTurn(QuoridorPlayer.ONE, offsetWallOnRight);

    var resultOne = validator.validate(match, turnOne);
    var resultTwo = validator.validate(match, turnTwo);
    var resultThree = validator.validate(match, turnThree);

    Assertions.assertTrue(resultOne.isError());
    Assertions.assertTrue(resultOne.getErrors().contains(ErrorMessage.COORDINATES_NOT_EMPTY));
    Assertions.assertTrue(resultTwo.isError());
    Assertions.assertTrue(resultTwo.getErrors().contains(ErrorMessage.COORDINATES_NOT_EMPTY));
    Assertions.assertTrue(resultThree.isError());
    Assertions.assertTrue(resultThree.getErrors().contains(ErrorMessage.COORDINATES_NOT_EMPTY));
  }
}
