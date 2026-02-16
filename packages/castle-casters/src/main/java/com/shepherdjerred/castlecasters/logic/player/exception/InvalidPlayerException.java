package com.shepherdjerred.castlecasters.logic.player.exception;

import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public class InvalidPlayerException extends RuntimeException {
  public InvalidPlayerException(QuoridorPlayer quoridorPlayer) {
    super(quoridorPlayer.toString());
  }
}
