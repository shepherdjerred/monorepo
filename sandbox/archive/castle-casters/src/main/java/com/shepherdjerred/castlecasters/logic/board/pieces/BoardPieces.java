package com.shepherdjerred.castlecasters.logic.board.pieces;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.piece.NullPiece;
import com.shepherdjerred.castlecasters.logic.piece.Piece;
import com.shepherdjerred.castlecasters.logic.piece.WallPiece;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.*;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Represents the pieces and their locations on a board.
 */
@ToString
@EqualsAndHashCode
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class BoardPieces {

  private final Map<Coordinate, Piece> pieces;
  private final Map<QuoridorPlayer, Coordinate> pawnLocations;
  @Getter
  private final int gridSize;

  public static BoardPieces from(BoardSettings boardSettings) {
    return from(boardSettings, new BoardPiecesInitializer());
  }

  public static BoardPieces fromState(BoardSettings settings, Map<QuoridorPlayer, Coordinate> pawns,
                                      Map<Coordinate, Piece> pieces) {
    if (pawns.size() != settings.getPlayerCount().toInt()) throw new IllegalArgumentException("Missing pawns");
    for (int i = 1; i <= pawns.size(); i++) {
      var player = QuoridorPlayer.fromInt(i);
      var position = pawns.get(player);
      if (position == null || position.x() % 2 != 0 || position.y() % 2 != 0
          || !new com.shepherdjerred.castlecasters.logic.piece.PawnPiece(player).equals(pieces.get(position))) {
        throw new IllegalArgumentException("Invalid pawn snapshot");
      }
    }
    for (var entry : pieces.entrySet()) {
      var c = entry.getKey();
      if (c.x() < 0 || c.y() < 0 || c.x() >= settings.getGridSize() || c.y() >= settings.getGridSize()) throw new IllegalArgumentException("Piece outside board");
    }
    return new BoardPieces(new HashMap<>(pieces), new HashMap<>(pawns), settings.getGridSize());
  }

  /**
   * Creates a new BoardPieces object.
   */
  public static BoardPieces from(BoardSettings boardSettings,
                                 BoardPiecesInitializer boardPiecesInitializer) {
    var gridSize = boardSettings.getGridSize();
    Map<QuoridorPlayer, Coordinate> pawnLocations = boardPiecesInitializer.getInitialPawnLocations(
        boardSettings);
    Map<Coordinate, Piece> pieces = boardPiecesInitializer.convertPawnLocationsToPieceLocations(
        pawnLocations);
    return new BoardPieces(pieces, pawnLocations, gridSize);
  }

  /**
   * Gets the location of the quoridorPlayer's pawn.
   *
   * @param quoridorPlayer The quoridorPlayer to get the pawn Coordinates of
   * @return The coordinate of the quoridorPlayer's pawn
   */
  public Coordinate getPawnLocation(QuoridorPlayer quoridorPlayer) {
    return pawnLocations.get(quoridorPlayer);
  }

  /**
   * Get the locations of all pawns on the board.
   */
  public Set<Coordinate> getPawnLocations() {
    return new HashSet<>(pawnLocations.values());
  }

  /**
   * Get the locations of all walls on the board.
   */
  public Set<Coordinate> getWallLocations() {
    return pieces.entrySet()
        .stream()
        .filter(entry -> entry.getValue() instanceof WallPiece)
        .map(Entry::getKey)
        .collect(Collectors.toSet());
  }

  /**
   * Returns the locations of all pieces on the board.
   */
  public Set<Coordinate> getPieceLocations() {
    return new HashSet<>(pieces.keySet());
  }

  /**
   * Moves a pawn.
   *
   * @param quoridorPlayer The owner of the pawn to move
   * @param destination    The new location of the pawn
   * @return The BoardPieces after the move
   */
  public BoardPieces movePawn(QuoridorPlayer quoridorPlayer, Coordinate destination) {
    var newPiecesMap = new HashMap<>(pieces);
    var newPawnLocations = new HashMap<>(pawnLocations);
    var originalPawnLocation = getPawnLocation(quoridorPlayer);
    var originalPiece = pieces.get(originalPawnLocation);

    newPiecesMap.remove(originalPawnLocation);
    newPiecesMap.put(destination, originalPiece);
    newPawnLocations.put(quoridorPlayer, destination);

    return new BoardPieces(newPiecesMap, newPawnLocations, gridSize);
  }

  /**
   * Places a wall.
   *
   * @param quoridorPlayer The owner of the wall to place
   * @param c1             First coordinate of the wall
   * @param c2             Second coordinate of the wall
   * @return The BoardPieces after the move
   */
  public BoardPieces placeWall(QuoridorPlayer quoridorPlayer,
                               Coordinate c1,
                               Coordinate vertex,
                               Coordinate c2) {
    var newPiecesMap = new HashMap<>(pieces);
    newPiecesMap.put(c1, new WallPiece(quoridorPlayer));
    newPiecesMap.put(vertex, new WallPiece(quoridorPlayer));
    newPiecesMap.put(c2, new WallPiece(quoridorPlayer));

    return new BoardPieces(newPiecesMap, pawnLocations, gridSize);
  }


  /**
   * Checks if a piece exists at a Coordinate.
   */
  public boolean hasPiece(Coordinate coordinate) {
    if (pieces.containsKey(coordinate)) {
      return pieces.get(coordinate) != NullPiece.INSTANCE;
    } else {
      return false;
    }
  }

  /**
   * Checks if a piece exists at a Coordinate.
   */
  public boolean isEmpty(Coordinate coordinate) {
    return !hasPiece(coordinate);
  }

  /**
   * Gets the piece at a Coordinate.
   *
   * @param coordinate The Coordinate to get the Piece from
   * @return The Piece at the Coordinate, or a NullPiece if there is none
   */
  public Piece getPiece(Coordinate coordinate) {
    if (hasPiece(coordinate)) {
      return pieces.get(coordinate);
    } else {
      return NullPiece.INSTANCE;
    }
  }
}
