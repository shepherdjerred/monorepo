package com.shepherdjerred.castlecasters.logic.board.search;


import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

public class AStarBoardSearchTest {

  @Test
  public void hasPathToAnyDestination_returnTrue_whenFindingPathTwoDifferentDiagonalSidesOnOpenBoard() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var search = new AStarBoardSearch();
    var src = new Coordinate(0, 0);
    Set<Coordinate> dest = new HashSet<>();
    dest.add(new Coordinate(16, 16));

    Assertions.assertTrue(search.hasPathToAnyDestination(board, src, dest));
  }

  @Test
  public void hasPathToAnyDestination_returnTrue_whenFindingPathTwoDifferentCardinalSidesOnOpenBoard() {
    var board = QuoridorBoard.from(new BoardSettings(9, PlayerCount.TWO));
    var search = new AStarBoardSearch();
    var src = new Coordinate(8, 0);
    Set<Coordinate> dest = new HashSet<>();
    dest.add(new Coordinate(0, 8));

    Assertions.assertTrue(search.hasPathToAnyDestination(board, src, dest));
  }
}
