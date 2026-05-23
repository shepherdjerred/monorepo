package com.shepherdjerred.castlecasters.logic.board.layout;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.board.exception.CoordinateOutOfBoundsException;
import lombok.*;

/**
 * Represents the Quoridor board layout. In a standard 9x9 game of Quoridor, the boardCells array
 * will be 17 * 17. The boardCells array stores both the pawn spaces and grooves where walls are
 * placed. Along with the WALL and PAWN BoardCells in the boardCells array, there are Vertex
 * BoardCells which represent areas on the board where walls can intersect on the board.
 */
@ToString
@EqualsAndHashCode
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class BoardLayout {

  @Getter
  private final int gridSize;
  private final BoardCell[][] boardCells;

  public static BoardLayout from(BoardSettings boardSettings) {
    var boardCellsInitializer = new BoardLayoutInitializer();
    return from(boardSettings, boardCellsInitializer);
  }

  /**
   * Creates a new board layout.
   */
  public static BoardLayout from(BoardSettings boardSettings,
                                 BoardLayoutInitializer initializer) {
    var boardCells = initializer.createBoardCells(boardSettings);
    return new BoardLayout(boardSettings.getGridSize(), boardCells);
  }

  /**
   * Returns the BoardCell at a given Coordinate.
   *
   * @param coordinate Coordinate of the BoardCell to get
   * @return The BoardCell at the Coordinate
   */
  public BoardCell getBoardCell(Coordinate coordinate) {
    if (isCoordinateValid(coordinate)) {
      return boardCells[coordinate.x()][coordinate.y()];
    } else {
      throw new CoordinateOutOfBoundsException(coordinate);
    }
  }

  /**
   * Checks if the BoardCell is a PAWN BoardCell.
   */
  public boolean isPawn(Coordinate coordinate) {
    return getBoardCell(coordinate).isPawn();
  }

  /**
   * Checks if the BoardCell is a WALL BoardCell.
   */
  public boolean isWall(Coordinate coordinate) {
    return getBoardCell(coordinate).isWall();
  }

  /**
   * Checks if the BoardCell is a WALL_VERTEX BoardCell.
   */
  public boolean isWallVertex(Coordinate coordinate) {
    return getBoardCell(coordinate).isVertex();
  }

  /**
   * Checks if a coordinate is valid in this BoardLayout.
   *
   * @param coordinate The Coordinate to check
   * @return True if the Coordinate is valid, false otherwise
   */
  public boolean isCoordinateValid(Coordinate coordinate) {
    var x = coordinate.x();
    var y = coordinate.y();
    return x >= 0
        && x <= gridSize - 1
        && y >= 0
        && y <= gridSize - 1;
  }

  /**
   * Checks if a Coordinate is invalid in this BoardLayout.
   *
   * @param coordinate The Coordinate to check
   * @return True if the Coordinate is invalid, false otherwise
   */
  public boolean isCoordinateInvalid(Coordinate coordinate) {
    return !isCoordinateValid(coordinate);
  }
}
