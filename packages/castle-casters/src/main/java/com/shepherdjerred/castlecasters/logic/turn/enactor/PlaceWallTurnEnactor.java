package com.shepherdjerred.castlecasters.logic.turn.enactor;

import com.shepherdjerred.castlecasters.logic.board.QuoridorBoard;
import com.shepherdjerred.castlecasters.logic.turn.PlaceWallTurn;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public class PlaceWallTurnEnactor implements TurnEnactor {

  /**
   * Takes the steps to transform a given board state by the parameters in a turn.
   *
   * @param turn  The turn to use when transforming the board
   * @param board The board state
   * @return The board state transformed by the turn
   */
  @Override
  public QuoridorBoard enactTurn(Turn turn, QuoridorBoard board) {
    if (turn instanceof PlaceWallTurn) {
      return enactPlaceWallTurn((PlaceWallTurn) turn, board);
    } else {
      throw new IllegalArgumentException("Turn is not a PlaceWallTurn " + turn);
    }
  }

  private QuoridorBoard enactPlaceWallTurn(PlaceWallTurn turn, QuoridorBoard board) {
    return board.placeWall(turn.causer(), turn.location());
  }
}
