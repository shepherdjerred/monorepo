package com.shepherdjerred.castlecasters.logic.player;

public enum QuoridorPlayer {
  ONE, TWO, THREE, FOUR, NULL;

  public static QuoridorPlayer fromInt(int i) {
    return QuoridorPlayer.values()[i - 1];
  }

  public int toInt() {
    return this.ordinal() + 1;
  }
}
