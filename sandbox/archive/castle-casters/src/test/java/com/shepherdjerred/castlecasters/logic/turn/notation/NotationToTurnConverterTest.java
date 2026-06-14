package com.shepherdjerred.castlecasters.logic.turn.notation;


import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class NotationToTurnConverterTest {
  @Test
  public void stringToTurn_returnsCorrectTurn_WhenMovingPawnToBottomLeft() {
    var converter = new NotationToTurnConverter();
    var notation = "a1";

    var actual = converter.convert(notation);
    var expected = new NormalMovePawnTurn(QuoridorPlayer.NULL, null, new Coordinate(0, 0));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void stringToTurn_returnsCorrectTurn_WhenMovingPawnToBottomRight() {
    var converter = new NotationToTurnConverter();
    var notation = "i1";

    var actual = converter.convert(notation);
    var expected = new NormalMovePawnTurn(QuoridorPlayer.NULL, null, new Coordinate(16, 0));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void stringToTurn_returnsCorrectTurn_WhenMovingPawnToTopLeft() {
    var converter = new NotationToTurnConverter();
    var notation = "a9";

    var actual = converter.convert(notation);
    var expected = new NormalMovePawnTurn(QuoridorPlayer.NULL, null, new Coordinate(0, 16));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void stringToTurn_returnsCorrectTurn_WhenMovingPawnToTopRight() {
    var converter = new NotationToTurnConverter();
    var notation = "i9";

    var actual = converter.convert(notation);
    var expected = new NormalMovePawnTurn(QuoridorPlayer.NULL, null, new Coordinate(16, 16));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void stringToTurn_returnsCorrectTurn_WhenPlacingWallHorizontally() {
    var converter = new NotationToTurnConverter();
    var notation = "a1h";

    var actual = converter.convert(notation);
    var expected = new PlaceWallTurn(QuoridorPlayer.NULL,
        new WallLocation(new Coordinate(0, 1), new Coordinate(1, 1), new Coordinate(2, 1)));

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void stringToTurn_returnsCorrectTurn_WhenPlacingWallVertically() {
    var converter = new NotationToTurnConverter();
    var notation = "a1v";

    var actual = converter.convert(notation);
    var expected = new PlaceWallTurn(QuoridorPlayer.NULL,
        new WallLocation(new Coordinate(1, 0), new Coordinate(1, 1), new Coordinate(1, 2)));

    Assertions.assertEquals(expected, actual);
  }
}
