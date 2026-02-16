package com.shepherdjerred.castlecasters.logic.board;


import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class QuoridorBoardTest {

  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsTwoCoordinates_whenFindingSpacesAtBottomLeft() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(0, 0);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);

    var expectedOne = new Coordinate(2, 0);
    var expectedTwo = new Coordinate(0, 2);

    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsTwoCoordinates_whenFindingSpacesAtBottomRight() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(16, 0);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);
    var expectedOne = new Coordinate(16, 2);
    var expectedTwo = new Coordinate(14, 0);

    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsTwoCoordinates_whenFindingSpacesAtTopLeft() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(0, 16);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);
    var expectedOne = new Coordinate(2, 16);
    var expectedTwo = new Coordinate(0, 14);

    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsTwoCoordinates_whenFindingSpacesAtTopRight() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(16, 16);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);
    var expectedOne = new Coordinate(14, 16);
    var expectedTwo = new Coordinate(16, 14);

    Assertions.assertTrue(actual.contains(expectedOne));
    Assertions.assertTrue(actual.contains(expectedTwo));
    Assertions.assertEquals(2, actual.size());
  }

  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsTopRightSpace_whenFindingSpacesDirectlyBelowTopRight() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(16, 14);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);
    var expected = new Coordinate(16, 16);

    Assertions.assertTrue(actual.contains(expected));
  }


  @Test
  public void getPawnSpacesAdjacentToPawnSpace_returnsBottomLeftSpace_whenFindingSpacesDirectlyAboveBottomLeft() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var coord = new Coordinate(0, 2);

    var actual = board.getPawnSpacesAdjacentToPawnSpace(coord);
    var expected = new Coordinate(0, 0);

    Assertions.assertTrue(actual.contains(expected));
  }

  @Test
  public void hasWall_returnsTrue_whenBoardHasWallOnWallVertexCell() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var wallLocation = new WallLocation(new Coordinate(0, 1),
        new Coordinate(1, 1),
        new Coordinate(2, 1));
    board = board.placeWall(QuoridorPlayer.ONE, wallLocation);
    Assertions.assertTrue(board.hasWall(new Coordinate(1, 1)));
  }

  @Test
  public void hasWall_returnsTrue_whenBoardHasWallOnWallCell() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var wallLocation = new WallLocation(new Coordinate(0, 1),
        new Coordinate(1, 1),
        new Coordinate(2, 1));
    board = board.placeWall(QuoridorPlayer.ONE, wallLocation);
    Assertions.assertTrue(board.hasWall(new Coordinate(0, 1)));
    Assertions.assertTrue(board.hasWall(new Coordinate(2, 1)));
  }

  @Test
  public void hasWall_returnFalse_whenBoardDoesntHaveWallOnWallVertexCell() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    Assertions.assertFalse(board.hasWall(new Coordinate(1, 1)));
  }

  @Test
  public void hasWall_returnsFalse_whenBoardDoesntHaveWallOnWallCell() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    Assertions.assertFalse(board.hasWall(new Coordinate(0, 1)));
    Assertions.assertFalse(board.hasWall(new Coordinate(0, 2)));
  }

  @Test
  public void hasWall_returnsFalse_whenCalledWithPawnCell() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    Assertions.assertFalse(board.hasWall(new Coordinate(0, 0)));
  }
}
