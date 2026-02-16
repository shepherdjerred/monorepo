package com.shepherdjerred.castlecasters.logic.board.exception;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import lombok.ToString;

@ToString
public class InvalidBoardTransformationException extends RuntimeException {

  public InvalidBoardTransformationException(Reason reason) {
    super(reason.toString());
  }

  public InvalidBoardTransformationException(Reason reason, Coordinate coordinate) {
    super(coordinate.toString() + " " + reason.toString());
  }

  public enum Reason {
    NULL, C1_NOT_WALL_CELL, VERTEX_NOT_WALL_VERTEX_CELL, C2_NOT_WALL_CELL, C1_NOT_EMPTY, VERTEX_NOT_EMPTY, C2_NOT_EMPTY, DESTINATION_NOT_PAWN_CELL, DESTINATION_NOT_EMPTY
  }
}
