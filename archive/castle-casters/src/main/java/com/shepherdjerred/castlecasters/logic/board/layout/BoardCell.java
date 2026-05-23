package com.shepherdjerred.castlecasters.logic.board.layout;

import lombok.ToString;

/**
 * This enum represents the types of cells there are. A PAWN BoardCell can have a PawnPiece placed
 * on it, a WALL and WALL_VERTEX BoardCell can have a WallPiece placed on it.
 */
@ToString
public enum BoardCell {
  PAWN, WALL, WALL_VERTEX;

  public boolean isPawn() {
    return this == PAWN;
  }

  public boolean isWall() {
    return this == WALL;
  }

  public boolean isVertex() {
    return this == WALL_VERTEX;
  }

  public char toChar() {
    if (this == PAWN) {
      return '■';
    } else if (this == WALL) {
      return ' ';
    } else if (this == WALL_VERTEX) {
      return ' ';
    } else {
      throw new UnsupportedOperationException("Unknown BoardCell " + this);
    }
  }

}
