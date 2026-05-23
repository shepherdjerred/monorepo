package com.shepherdjerred.castlecasters.logic.turn.notation;


public enum WallOrientation {
  VERTICAL, HORIZONTAL;

  static WallOrientation fromNotationChar(char c) {
    if (c == 'v') {
      return VERTICAL;
    } else if (c == 'h') {
      return HORIZONTAL;
    } else {
      throw new UnsupportedOperationException();
    }
  }

  char toNotationChar() {
    if (this == VERTICAL) {
      return 'v';
    } else if (this == HORIZONTAL) {
      return 'h';
    } else {
      throw new UnsupportedOperationException();
    }
  }
}

