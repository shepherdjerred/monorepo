package com.shepherdjerred.castlecasters.engine;

import java.util.Map;

/** Read-only inspection and fixture seam; the development launcher owns its transport. */
public interface InspectableGame extends GameLogic {
  default void interruptConnection() {
    throw new IllegalStateException("No remote connection");
  }

  Map<String, Object> inspect();

  default void scenario(String name, long seed) {
    throw new IllegalArgumentException("Unknown scenario: " + name);
  }
}
