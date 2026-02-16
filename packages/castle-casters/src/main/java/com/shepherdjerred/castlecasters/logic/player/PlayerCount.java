package com.shepherdjerred.castlecasters.logic.player;

public enum PlayerCount {
  TWO, FOUR;

  public int toInt() {
    return switch (this) {
      case TWO -> 2;
      case FOUR -> 4;
    };
  }
}
