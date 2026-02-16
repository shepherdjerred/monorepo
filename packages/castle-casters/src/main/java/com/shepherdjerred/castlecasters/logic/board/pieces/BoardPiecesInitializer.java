package com.shepherdjerred.castlecasters.logic.board.pieces;

import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.piece.PawnPiece;
import com.shepherdjerred.castlecasters.logic.piece.Piece;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

import java.util.HashMap;
import java.util.Map;

/**
 * Creates initial locations for pieces on a board.
 */
public class BoardPiecesInitializer {

  /**
   * Initialize pawn pieces for the players.
   */
  public Map<QuoridorPlayer, Coordinate> getInitialPawnLocations(BoardSettings boardSettings) {
    var gridSize = boardSettings.getGridSize();

    Map<QuoridorPlayer, Coordinate> pawns = new HashMap<>();

    pawns.put(QuoridorPlayer.ONE, getStartingPawnCoordinateForPlayerOne(gridSize));
    pawns.put(QuoridorPlayer.TWO, getStartingPawnCoordinateForPlayerTwo(gridSize));

    if (boardSettings.getPlayerCount() == PlayerCount.FOUR) {
      pawns.put(QuoridorPlayer.THREE, getStartingPawnCoordinateForPlayerThree(gridSize));
      pawns.put(QuoridorPlayer.FOUR, getStartingPawnCoordinateForPlayerFour(gridSize));
    }

    return pawns;
  }

  public Map<Coordinate, Piece> convertPawnLocationsToPieceLocations(Map<QuoridorPlayer, Coordinate> pawnLocations) {
    Map<Coordinate, Piece> pieces = new HashMap<>();
    pawnLocations.forEach((player, coordinate) -> pieces.put(coordinate, new PawnPiece(player)));
    return pieces;
  }

  private Coordinate getStartingPawnCoordinateForPlayerOne(int gridSize) {
    var midpoint = gridSize / 2;
    return new Coordinate(midpoint, 0);
  }

  private Coordinate getStartingPawnCoordinateForPlayerTwo(int gridSize) {
    var midpoint = gridSize / 2;
    return new Coordinate(midpoint, gridSize - 1);
  }

  private Coordinate getStartingPawnCoordinateForPlayerThree(int gridSize) {
    var midpoint = gridSize / 2;
    return new Coordinate(0, midpoint);
  }

  private Coordinate getStartingPawnCoordinateForPlayerFour(int gridSize) {
    var midpoint = gridSize / 2;
    return new Coordinate(gridSize - 1, midpoint);
  }
}
