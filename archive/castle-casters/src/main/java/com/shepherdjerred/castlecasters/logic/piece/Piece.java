package com.shepherdjerred.castlecasters.logic.piece;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public interface Piece {

  QuoridorPlayer owner();

  char toChar();
}
