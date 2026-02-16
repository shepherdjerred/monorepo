package com.shepherdjerred.castlecasters.logic.turn.notation;


import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class TurnToNotationTest {

  @Test
  public void turnToString_returnsCorrectNotation_WhenMovingToBottomLeft() {
    var converter = new TurnToNotationConverter();
    var movePawnTurn = new NormalMovePawnTurn(QuoridorPlayer.ONE,
        new Coordinate(2, 0),
        new Coordinate(0, 0));

    var actual = converter.convert(movePawnTurn);
    var expected = "a1";

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void turnToString_returnsCorrectNotation_WhenMovingToBottomRight() {
    var converter = new TurnToNotationConverter();
    var movePawnTurn = new NormalMovePawnTurn(QuoridorPlayer.ONE,
        new Coordinate(14, 0),
        new Coordinate(16, 0));

    var actual = converter.convert(movePawnTurn);
    var expected = "i1";

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void turnToString_returnsCorrectNotation_WhenMovingToTopLeft() {
    var converter = new TurnToNotationConverter();
    var movePawnTurn = new NormalMovePawnTurn(QuoridorPlayer.ONE,
        new Coordinate(0, 14),
        new Coordinate(0, 16));

    var actual = converter.convert(movePawnTurn);
    var expected = "a9";

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void turnToString_returnsCorrectNotation_WhenMovingToTopRight() {
    var converter = new TurnToNotationConverter();
    var movePawnTurn = new NormalMovePawnTurn(QuoridorPlayer.ONE,
        new Coordinate(16, 14),
        new Coordinate(16, 16));

    var actual = converter.convert(movePawnTurn);
    var expected = "i9";

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void turnToString_returnsCorrectNotation_WhenPlacingWallHorizontally() {
    var converter = new TurnToNotationConverter();
    var placeWallTurn = new PlaceWallTurn(QuoridorPlayer.ONE,
        new WallLocation(new Coordinate(0, 1), new Coordinate(1, 1), new Coordinate(2, 1)));

    var actual = converter.convert(placeWallTurn);
    var expected = "a1h";

    Assertions.assertEquals(expected, actual);
  }

  @Test
  public void turnToString_returnsCorrectNotation_WhenPlacingWallVertically() {
    var converter = new TurnToNotationConverter();
    var placeWallTurn = new PlaceWallTurn(QuoridorPlayer.ONE,
        new WallLocation(new Coordinate(1, 0), new Coordinate(1, 1), new Coordinate(1, 2)));

    var actual = converter.convert(placeWallTurn);
    var expected = "a1v";

    Assertions.assertEquals(expected, actual);
  }
}
