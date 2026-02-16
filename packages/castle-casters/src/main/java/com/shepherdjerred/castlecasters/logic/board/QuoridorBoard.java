package com.shepherdjerred.castlecasters.logic.board;

import com.google.common.base.Preconditions;
import com.shepherdjerred.castlecasters.logic.board.exception.CoordinateOutOfBoundsException;
import com.shepherdjerred.castlecasters.logic.board.exception.InvalidBoardTransformationException;
import com.shepherdjerred.castlecasters.logic.board.exception.InvalidBoardTransformationException.Reason;
import com.shepherdjerred.castlecasters.logic.board.layout.BoardCell;
import com.shepherdjerred.castlecasters.logic.board.layout.BoardLayout;
import com.shepherdjerred.castlecasters.logic.board.layout.BoardLayoutInitializer;
import com.shepherdjerred.castlecasters.logic.board.pieces.BoardPieces;
import com.shepherdjerred.castlecasters.logic.board.pieces.BoardPiecesInitializer;
import com.shepherdjerred.castlecasters.logic.piece.Piece;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.util.HashSet;
import java.util.Set;


/**
 * Composes BoardLayout and BoardPieces to represent a Quoridor QuoridorBoard.
 */
@ToString
@EqualsAndHashCode
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class QuoridorBoard {

  private final BoardLayout boardLayout;
  private final BoardPieces boardPieces;
  private final BoardSettings boardSettings;

  public static QuoridorBoard from(BoardSettings boardSettings) {
    return from(boardSettings,
        new BoardLayoutInitializer(),
        new BoardPiecesInitializer());
  }

  /**
   * Creates a new QuoridorBoard.
   */
  public static QuoridorBoard from(BoardSettings boardSettings,
                                   BoardLayoutInitializer boardLayoutInitializer,
                                   BoardPiecesInitializer boardPiecesInitializer) {
    var layout = BoardLayout.from(boardSettings, boardLayoutInitializer);
    var pieces = BoardPieces.from(boardSettings, boardPiecesInitializer);
    return new QuoridorBoard(layout, pieces, boardSettings);
  }

  /**
   * Returns the number of pawn spaces and wall spaces on each axis of the board.
   */
  public int getGridSize() {
    return boardSettings.getGridSize();
  }

  /**
   * Returns how many player pawns are on this board.
   */
  public PlayerCount getPlayerCount() {
    return boardSettings.getPlayerCount();
  }

  /**
   * Returns the number of pawn spaces on each axis of the board.
   */
  public int getBoardSize() {
    return boardSettings.getBoardSize();
  }

  /**
   * Gets the location of the quoridorPlayer's pawn.
   *
   * @param quoridorPlayer The quoridorPlayer to get the pawn Coordinates of
   * @return The coordinate of the quoridorPlayer's pawn
   */
  public Coordinate getPawnLocation(QuoridorPlayer quoridorPlayer) {
    return boardPieces.getPawnLocation(quoridorPlayer);
  }

  public Set<Coordinate> getPieceLocations() {
    return boardPieces.getPieceLocations();
  }

  public Set<Coordinate> getPawnLocations() {
    return boardPieces.getPawnLocations();
  }

  public Set<Coordinate> getWallLocations() {
    return boardPieces.getWallLocations();
  }

  public Set<Coordinate> getPawnSpacesAdjacentToPawnSpace(Coordinate coordinate) {
    Preconditions.checkArgument(isPawnBoardCell(coordinate));
    return getValidCardinalCoordinatesThatAreDistanceAway(coordinate, 2);
  }

  public Set<Coordinate> getPawnSpacesAdjacentToPawnSpace(Coordinate coordinate, int range) {
    Preconditions.checkArgument(isPawnBoardCell(coordinate));
    return getValidCardinalCoordinatesThatAreDistanceAway(coordinate, range * 2);
  }

  public Set<Coordinate> getWallCellsAdjacentToPawnSpace(Coordinate coordinate) {
    Preconditions.checkArgument(isPawnBoardCell(coordinate));
    return getValidCardinalCoordinatesThatAreDistanceAway(coordinate, 1);
  }

  public Set<Coordinate> getWallCellsAdjacentToPawnSpace(Coordinate coordinate, int range) {
    Preconditions.checkArgument(isPawnBoardCell(coordinate));
    // TODO: challenge for Chase
    return getValidCardinalCoordinatesThatAreDistanceAway(coordinate, (range * 2) - 1);
  }

  private Set<Coordinate> getValidCardinalCoordinatesThatAreDistanceAway(Coordinate origin, int range) {
    Set<Coordinate> spaces = new HashSet<>();
    var gridSize = boardSettings.getGridSize();
    int x = origin.x();
    int y = origin.y();

    if (x - range >= 0) {
      spaces.add(origin.toLeft(range));
    }

    if (x + range <= gridSize - 1) {
      spaces.add(origin.toRight(range));
    }

    if (y - range >= 0) {
      spaces.add(origin.below(range));
    }

    if (y + range <= gridSize - 1) {
      spaces.add(origin.above(range));
    }

    return spaces;
  }

  /**
   * Moves a pawn.
   *
   * @param quoridorPlayer The owner of the pawn to move
   * @param destination    The new location of the pawn
   * @return The BoardPieces after the move
   */
  // TODO better validation
  // TODO extract validation
  public QuoridorBoard movePawn(QuoridorPlayer quoridorPlayer, Coordinate destination) {
    if (isCoordinateInvalid(destination)) {
      throw new CoordinateOutOfBoundsException(destination);
    }

    if (!isPawnBoardCell(destination)) {
      throw new InvalidBoardTransformationException(Reason.DESTINATION_NOT_PAWN_CELL, destination);
    }

    if (!isEmpty(destination)) {
      throw new InvalidBoardTransformationException(Reason.DESTINATION_NOT_EMPTY, destination);
    }

    var newBoardPieces = boardPieces.movePawn(quoridorPlayer, destination);
    return new QuoridorBoard(boardLayout, newBoardPieces, boardSettings);
  }

  /**
   * Places a wall.
   */
  // TODO better validation
  // TODO extract validation
  public QuoridorBoard placeWall(QuoridorPlayer quoridorPlayer, WallLocation location) {
    var c1 = location.firstCoordinate();
    var vertex = location.vertex();
    var c2 = location.secondCoordinate();

    if (isCoordinateInvalid(c1)) {
      throw new CoordinateOutOfBoundsException(c1);
    }
    if (isCoordinateInvalid(vertex)) {
      throw new CoordinateOutOfBoundsException(vertex);
    }
    if (isCoordinateInvalid(c2)) {
      throw new CoordinateOutOfBoundsException(c2);
    }

    Coordinate coordinate = null;
    Reason reason = Reason.NULL;
    if (!isWallBoardCell(c1)) {
      coordinate = c1;
      reason = Reason.C1_NOT_WALL_CELL;
    }

    if (!isWallVertexBoardCell(vertex)) {
      coordinate = vertex;
      reason = Reason.VERTEX_NOT_WALL_VERTEX_CELL;
    }

    if (!isWallBoardCell(c2)) {
      coordinate = c2;
      reason = Reason.C2_NOT_WALL_CELL;
    }

    if (!isEmpty(c1)) {
      coordinate = c1;
      reason = Reason.C1_NOT_EMPTY;
    }

    if (!isEmpty(vertex)) {
      coordinate = vertex;
      reason = Reason.VERTEX_NOT_EMPTY;
    }

    if (!isEmpty(c2)) {
      coordinate = c2;
      reason = Reason.C2_NOT_EMPTY;
    }

    if (reason != Reason.NULL) {
      throw new InvalidBoardTransformationException(reason, coordinate);
    }

    var newBoardPieces = boardPieces.placeWall(quoridorPlayer, c1, vertex, c2);
    return new QuoridorBoard(boardLayout, newBoardPieces, boardSettings);
  }

  public BoardCell getBoardCell(Coordinate coordinate) {
    return boardLayout.getBoardCell(coordinate);
  }

  public boolean isPawnBoardCell(Coordinate coordinate) {
    return boardLayout.isPawn(coordinate);
  }

  public boolean isWallBoardCell(Coordinate coordinate) {
    return boardLayout.isWall(coordinate);
  }

  public boolean isWallVertexBoardCell(Coordinate coordinate) {
    return boardLayout.isWallVertex(coordinate);
  }

  public boolean isCoordinateValid(Coordinate coordinate) {
    return boardLayout.isCoordinateValid(coordinate);
  }

  public boolean isCoordinateInvalid(Coordinate coordinate) {
    return boardLayout.isCoordinateInvalid(coordinate);
  }

  /**
   * Checks if a piece exists at a Coordinate.
   */
  public boolean hasPiece(Coordinate coordinate) {
    return boardPieces.hasPiece(coordinate);
  }

  /**
   * Checks if a piece exists at a Coordinate.
   */
  public boolean isEmpty(Coordinate coordinate) {
    return !hasPiece(coordinate);
  }

  public boolean hasWall(Coordinate coordinate) {
    return (isWallBoardCell(coordinate) || isWallVertexBoardCell(coordinate)) && hasPiece(
        coordinate);
  }

  /**
   * Gets the piece at a Coordinate.
   *
   * @param coordinate The Coordinate to get the Piece from
   * @return The Piece at the Coordinate, or a NullPiece if there is none
   */
  public Piece getPiece(Coordinate coordinate) {
    return boardPieces.getPiece(coordinate);
  }
}
