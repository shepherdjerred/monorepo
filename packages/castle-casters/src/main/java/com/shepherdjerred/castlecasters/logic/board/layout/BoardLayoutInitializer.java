package com.shepherdjerred.castlecasters.logic.board.layout;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;

/**
 * Creates a matrix of BoardCells based on board settings.
 */
public class BoardLayoutInitializer {

  /**
   * Creates a matrix of BoardCells. Used for constructor initialization.
   *
   * @param boardSettings Settings to use when creating the board
   * @return A matrix of BoardCell based on the board settings
   */
  public BoardCell[][] createBoardCells(BoardSettings boardSettings) {
    var gridSize = boardSettings.getGridSize();
    var boardCells = new BoardCell[gridSize][gridSize];

    for (int x = 0; x < gridSize; x++) {
      for (int y = 0; y < gridSize; y++) {
        boardCells[x][y] = createBoardCell(new Coordinate(x, y));
      }
    }

    return boardCells;
  }

  /**
   * Creates a single BoardCell.
   *
   * @param coordinate The Coordinate at which that the BoardCell will exist
   * @return The BoardCell to should use
   */
  private BoardCell createBoardCell(Coordinate coordinate) {
    if (shouldBeWallVertexCell(coordinate)) {
      return BoardCell.WALL_VERTEX;
    } else if (shouldBePawnCell(coordinate)) {
      return BoardCell.PAWN;
    } else if (shouldBeWallCell(coordinate)) {
      return BoardCell.WALL;
    } else {
      throw new UnsupportedOperationException("Couldn't get BoardCell for " + coordinate);
    }
  }

  /**
   * Checks if a BoardCell should be a Vertex BoardCell.
   *
   * @param coordinate The Coordinate to check
   * @return True if the BoardCell should be Null, or false otherwise
   */
  private boolean shouldBeWallVertexCell(Coordinate coordinate) {
    int x = coordinate.x();
    int y = coordinate.y();

    return x % 2 != 0
        && y % 2 != 0;
  }

  /**
   * Checks if a BoardCell should be a Pawn BoardCell.
   *
   * @param coordinate The Coordinate to check
   * @return True if the BoardCell should be a Pawn BoardCell, or false otherwise
   */
  private boolean shouldBePawnCell(Coordinate coordinate) {
    int x = coordinate.x();
    int y = coordinate.y();

    return x % 2 == 0
        && y % 2 == 0;
  }

  /**
   * Checks if a BoardCell should be a wall BoardCell.
   *
   * @param coordinate The Coordinate to check
   * @return True if the BoardCell should be a Wall BoardCell, or false otherwise
   */
  private boolean shouldBeWallCell(Coordinate coordinate) {
    int x = coordinate.x();
    int y = coordinate.y();

    return x % 2 != 0
        && y % 2 == 0
        || x % 2 == 0
        && y % 2 != 0;
  }
}
