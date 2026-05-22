package com.shepherdjerred.castlecasters.logic.piece;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.ToString;

/**
 * Represents an empty piece
 */
@ToString
public enum NullPiece implements Piece {
  INSTANCE;

  @Override
  public QuoridorPlayer owner() {
    return QuoridorPlayer.NULL;
  }

  @Override
  public char toChar() {
    return ' ';
  }
}
