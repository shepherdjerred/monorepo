package com.shepherdjerred.castlecasters.logic.board.search;


import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import com.shepherdjerred.castlecasters.logic.board.WallLocation;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.extern.log4j.Log4j2;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.HashSet;

@Log4j2
public class BoardAStarSearchNodeTest {

  @Test
  public void getChildNodes_ReturnsTwoNodes_WhenAtBottomLeft() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var node = new BoardAStarSearchNode(0,
        board,
        new Coordinate(0, 0),
        new HashSet<>(),
        null,
        0,
        0);

    Assertions.assertEquals(2, node.getChildNodes().size());
  }

  @Test
  public void getChildNodes_ReturnsTwoNodes_WhenAtBottomRight() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var node = new BoardAStarSearchNode(0,
        board,
        new Coordinate(16, 0),
        new HashSet<>(),
        null,
        0,
        0);

    Assertions.assertEquals(2, node.getChildNodes().size());
  }

  @Test
  public void getChildNodes_ReturnsTwoNodes_WhenAtTopLeft() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var node = new BoardAStarSearchNode(0,
        board,
        new Coordinate(0, 16),
        new HashSet<>(),
        null,
        0,
        0);

    Assertions.assertEquals(2, node.getChildNodes().size());
  }

  @Test
  public void getChildNodes_ReturnsTwoNodes_WhenAtTopRight() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var node = new BoardAStarSearchNode(0,
        board,
        new Coordinate(16, 16),
        new HashSet<>(),
        null,
        0,
        0);

    Assertions.assertEquals(2, node.getChildNodes().size());
  }

  @Test
  public void getChildNodes_ReturnsTwoNodes_WhenAtBottomMiddleAndBlockByWallAtTop() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var wallOne = new WallLocation(new Coordinate(8, 1),
        new Coordinate(9, 1),
        new Coordinate(10, 1));
    var wallTwo = new WallLocation(new Coordinate(6, 1),
        new Coordinate(5, 1),
        new Coordinate(4, 1));
    board = board.placeWall(QuoridorPlayer.ONE, wallOne);
    board = board.placeWall(QuoridorPlayer.ONE, wallTwo);
    var node = new BoardAStarSearchNode(0,
        board,
        new Coordinate(16, 16),
        new HashSet<>(),
        null,
        0,
        0);

    Assertions.assertEquals(2, node.getChildNodes().size());
  }
}
