package com.shepherdjerred.castlecasters.engine.input.keyboard;

import java.util.HashMap;
import java.util.Map;

public class KeyTracker {

  private final Map<Key, Boolean> pressedKeys = new HashMap<>();

  public void setKeyAsPressed(Key key) {
    setKey(key, true);
  }

  public void setKeyAsUnpressed(Key key) {
    setKey(key, false);
  }

  public void setKey(Key key, boolean value) {
    pressedKeys.put(key, value);
  }

  public boolean isKeyPressed(Key key) {
    return pressedKeys.getOrDefault(key, false);
  }
}
