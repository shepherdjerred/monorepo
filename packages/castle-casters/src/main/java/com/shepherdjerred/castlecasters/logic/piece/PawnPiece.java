package com.shepherdjerred.castlecasters.logic.piece;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public record PawnPiece(QuoridorPlayer owner) implements Piece {

  @Override
  public char toChar() {
    return (char) (owner.toInt() + '0');
  }
}
