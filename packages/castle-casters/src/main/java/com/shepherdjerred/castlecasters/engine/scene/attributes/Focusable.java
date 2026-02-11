package com.shepherdjerred.castlecasters.engine.scene.attributes;

public interface Focusable {

  void onFocus();

  void onUnfocus();

  boolean isFocused();
}
