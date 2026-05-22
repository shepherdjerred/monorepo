package com.shepherdjerred.castlecasters.logic.piece;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public record WallPiece(QuoridorPlayer owner) implements Piece {

  @Override
  public char toChar() {
    return 'W';
  }
}
