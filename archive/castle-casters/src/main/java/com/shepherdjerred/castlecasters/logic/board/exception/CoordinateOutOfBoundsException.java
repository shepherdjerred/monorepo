package com.shepherdjerred.castlecasters.logic.board.exception;

import com.shepherdjerred.castlecasters.logic.board.Coordinate;

public class CoordinateOutOfBoundsException extends RuntimeException {

  public CoordinateOutOfBoundsException(Coordinate coordinate) {
    super(coordinate.toString());
  }
}
